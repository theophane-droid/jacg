import { state } from "./state.js";
import { el } from "./dom.js";

export function propertyValue(data, field) {
  if (!field || field === "__none") return "";
  if (field === "__degree") return data.degree || 0;
  if (field === "__type") return data.type || data.label || "";
  if (field === "__labels") return (data.labels || []).join(":");
  if (field === "label") return data.label || data.caption || "";
  if (field === "__note") return data.note || data.properties?.__graph_note || "";
  if (field === "__tags") return (data.tags || data.properties?.__graph_tags || []).join(",");

  // Virtual aggregate edges expose normalized event fields as arrays. Keep common
  // event field names useful in the display selector even when the edge is computed.
  const aliases = {
    service: "services",
    proto: "protos",
    id_resp_p: "destination_ports",
    id_orig_h: "source_value",
    id_resp_h: "destination_value",
    source: "source_value",
    target: "destination_value"
  };
  const direct = field in data ? data[field] : undefined;
  const aliased = aliases[field] && aliases[field] in data ? data[aliases[field]] : undefined;
  const nested = data.properties?.[field] ?? (aliases[field] ? data.properties?.[aliases[field]] : undefined);
  const value = direct ?? aliased ?? nested ?? "";
  return Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined && item !== "").join(",") : value;
}

function normalizedTags(data) {
  const raw = data.tags || data.properties?.__graph_tags || [];
  return (Array.isArray(raw) ? raw : String(raw || "").split(","))
    .map((tag) => String(tag || "").trim())
    .filter(Boolean);
}

function edgePairKey(edge) {
  const data = edge.data();
  return `${data.source_value || data.source}->${data.destination_value || data.target}`;
}

function explicitEdgeColor(edge) {
  const data = edge.data();
  const colors = data.event_colors || data.properties?.event_colors || [];
  return data.customColor || data.properties?.__graph_color || colors.find(Boolean) || "";
}

export function parseDisplayFields(value) {
  return String(value || "").split(",").map((field) => field.trim()).filter(Boolean);
}

export function displayFromFields(data, fields, fallback) {
  const parts = [];
  for (const field of fields) {
    const value = propertyValue(data, field);
    if (value !== "" && value !== undefined && value !== null) parts.push(String(value));
  }
  return parts.length ? parts.join(" | ") : fallback;
}

export function appendDisplayField(inputId, field) {
  if (!field || field === "__none") return;
  const input = el(inputId);
  const fields = parseDisplayFields(input.value);
  if (!fields.includes(field)) {
    fields.push(field);
    input.value = fields.join(",");
  }
  applyCaptions();
}

function nodeThreatColor(node) {
  const data = node.data();
  if (data.customColor) return data.customColor;
  if (data.properties?.__graph_color) return data.properties.__graph_color;
  const props = data.properties || {};
  if ((data.labels || []).some((label) => /event$/i.test(label)) || String(data.type || "").toLowerCase().includes("event")) return "#8b949e";
  if (node.hasClass("internal")) return "#00f5d4";
  if (node.hasClass("external")) return "#6e7681";
  const haystack = [
    props.status, props.state, props.risk, props.category,
    props.compromised, props.reachable, props.bottleneck,
    data.label, data.caption
  ].join(" ").toLowerCase();
  if (props.compromised === true || haystack.includes("compromis")) return "#da3633";
  if (props.bottleneck === true || haystack.includes("bottleneck") || haystack.includes("monitor")) return "#00f5d4";
  if (props.reachable === true || haystack.includes("reachable") || haystack.includes("risk")) return "#d29922";
  if (node.degree(false) >= 5) return "#00f5d4";
  return "#64748b";
}

export function applyCaptions() {
  if (!state.cy) return;
  const nodeFields = parseDisplayFields(el("nodeLabelFieldsInput").value);
  const edgeFields = parseDisplayFields(el("edgeLabelFieldsInput").value);
  state.cy.nodes().forEach((node) => {
    const value = displayFromFields(node.data(), nodeFields, node.data("caption") || node.id());
    node.data("renderLabel", String(value));
  });
  state.cy.edges().forEach((edge) => {
    const value = displayFromFields(edge.data(), edgeFields, edge.data("caption") || edge.data("type"));
    edge.data("renderLabel", String(value));
  });
  applyStyle();
}

export function updateLabelVisibility() {
  if (!state.cy) return;
  const zoom = state.cy.zoom();
  const showNodeLabels = state.labelsVisible && zoom >= 0.62;
  const showEdgeLabels = state.labelsVisible && zoom >= 0.9;
  state.cy.nodes().forEach((node) => {
    const visible = showNodeLabels || node.hasClass("hovered") || node.selected();
    node.data("visibleLabel", visible ? node.data("renderLabel") : "");
  });
  state.cy.edges().forEach((edge) => {
    const visible = showEdgeLabels || edge.hasClass("highlighted") || edge.selected();
    edge.data("visibleLabel", visible ? edge.data("renderLabel") : "");
  });
}

function numericMetric(data, field, fallback) {
  const value = Number(propertyValue(data, field));
  return Number.isFinite(value) ? value : fallback;
}

export function applyStyle() {
  if (!state.cy) return;
  const nodeSizeField = el("nodeSizeField").value;
  const edgeWidthField = el("edgeWidthField").value;

  state.cy.nodes().forEach((node) => {
    const degree = node.degree(false);
    node.data("degree", degree);
    const metric = nodeSizeField === "__none" ? degree : numericMetric(node.data(), nodeSizeField, degree);
    node.data("size", Math.max(28, Math.min(72, 28 + Math.sqrt(Math.max(0, metric)) * 3.5)));
    node.data("hoverSize", Math.max(32, Math.min(83, node.data("size") * 1.15)));
    node.data("statusColor", nodeThreatColor(node));
  });

  const aggregateColors = new Map();

  state.cy.edges().forEach((edge) => {
    const color = explicitEdgeColor(edge);
    if (color) {
      aggregateColors.set(edgePairKey(edge), color);
    }
  });

  state.cy.edges().forEach((edge) => {
    const fallback = edge.data("event_count") || edge.data("properties")?.event_count || edge.data("properties")?.count || 1;
    const metric = edgeWidthField === "__none" ? fallback : numericMetric(edge.data(), edgeWidthField, fallback);
    const computedWidth = Math.max(1, Math.min(11, 1 + Math.log1p(Math.max(0, metric)) * 1.15));
    edge.data("width", computedWidth);
    edge.data("edgeColor", explicitEdgeColor(edge) || aggregateColors.get(edgePairKey(edge)) || "#6e7681");
    edge.data("tags", normalizedTags(edge.data()));
    const type = `${edge.data("type") || ""} ${edge.data("properties")?.import_label || ""}`.toLowerCase();
    edge.removeClass("kerberos-edge conn-edge has-note has-tags custom-color virtual-edge event-link-edge event-edge");
    if (edge.data("isVirtual")) edge.addClass("virtual-edge");
    if (edge.data("isEvent")) edge.addClass("event-edge");
    if (["SRC_OF", "DST_TO"].includes(edge.data("type"))) edge.addClass("event-link-edge");
    if (type.includes("kerberos") || type.includes("client_to_service")) edge.addClass("kerberos-edge");
    else if (type.includes("conn") || type.includes("id_orig_h_to_id_resp_h")) edge.addClass("conn-edge");
    if (edge.data("note") || edge.data("properties")?.__graph_note) edge.addClass("has-note");
    if (edge.data("tags")?.length) edge.addClass("has-tags");
    if (explicitEdgeColor(edge)) edge.addClass("custom-color");
  });

  state.cy.nodes().forEach((node) => {
    node.data("tags", normalizedTags(node.data()));
    node.removeClass("has-note has-tags custom-color");
    if (node.data("note") || node.data("properties")?.__graph_note) node.addClass("has-note");
    if (node.data("tags")?.length) node.addClass("has-tags");
    if (node.data("customColor") || node.data("properties")?.__graph_color) node.addClass("custom-color");
  });

  updateLabelVisibility();

  state.cy.style()
    .selector("node").style({
      "background-color": "data(statusColor)",
      "border-color": "rgba(255,255,255,0)",
      "border-width": 0,
      width: "data(size)", height: "data(size)",
      label: "data(visibleLabel)",
      color: "#d7e0e7", "font-size": 10,
      "font-family": "IBM Plex Mono, SFMono-Regular, Consolas, monospace",
      "text-background-color": "#0b1016", "text-background-opacity": 0.78,
      "text-background-padding": 3, "text-margin-y": -8,
      "text-wrap": "wrap", "text-max-width": 140,
      "transition-property": "opacity, width, height, shadow-blur",
      "transition-duration": "80ms", "transition-timing-function": "ease-out",
      "shadow-blur": 7, "shadow-color": "data(statusColor)", "shadow-opacity": 0.22
    })
    .selector("node.hovered").style({
      width: "data(hoverSize)", height: "data(hoverSize)",
      "shadow-blur": 14, "shadow-opacity": 0.32, label: "data(renderLabel)"
    })
    .selector("node.event").style({ shape: "diamond", "background-color": "#8b949e", width: 22, height: 22, "shadow-color": "#8b949e" })
    .selector("node.internal").style({ "border-color": "rgba(0,245,212,0.45)", "border-width": 1 })
    .selector("node.external").style({ "border-color": "rgba(56,189,248,0.45)", "border-width": 1 })
    .selector("node.has-note").style({ "border-color": "#f4a261", "border-width": 2 })
    .selector("node.custom-color").style({ "shadow-opacity": 0.38 })
    .selector("edge").style({
      width: "data(width)", opacity: 0.4,
      "line-color": "data(edgeColor)",
      "target-arrow-shape": "none", "curve-style": "bezier",
      "line-style": "dashed", "line-dash-pattern": [2, 10], "line-dash-offset": 0,
      label: "data(visibleLabel)", color: "#b6c6cf", "font-size": 9,
      "font-family": "IBM Plex Mono, SFMono-Regular, Consolas, monospace",
      "text-background-color": "#0b1016", "text-background-opacity": 0.76,
      "text-background-padding": 2, "text-rotation": "autorotate",
      "transition-property": "opacity, line-color, target-arrow-color, width",
      "transition-duration": "180ms"
    })
    .selector("edge.virtual-edge").style({ opacity: 0.72, "line-style": "solid", "target-arrow-shape": "triangle", "target-arrow-color": "data(edgeColor)" })
    .selector("edge.event-edge").style({ opacity: 0.72, "line-style": "dashed", "line-dash-pattern": [4, 8], "target-arrow-shape": "none" })
    .selector("edge.event-link-edge").style({ width: 1, opacity: 0.5, "line-style": "dashed", "line-dash-pattern": [3, 8], "line-color": "rgba(139,148,158,0.58)" })
    .selector("edge.kerberos-edge").style({ "line-dash-pattern": [18, 12] })
    .selector("edge.conn-edge").style({ "line-dash-pattern": [1, 9] })
    .selector("edge.has-note").style({ opacity: 0.78 })
    .selector("edge.has-tags").style({ "line-style": "dashed", opacity: 0.82 })
    .selector("edge.custom-color").style({ "line-color": "data(edgeColor)", "target-arrow-color": "data(edgeColor)", opacity: 0.9 })
    .selector(".faded").style({ opacity: 0.08 })
    .selector("node.highlighted").style({ opacity: 1, "border-color": "rgba(255,255,255,0)", "border-width": 0 })
    .selector("node.focus-node").style({ "border-color": "#e7fff9", "border-width": 4 })
    .selector("edge.highlighted").style({ opacity: 1, "line-color": "#00f5d4", width: 2, label: "data(renderLabel)" })
    .selector(":selected").style({ "border-color": "#ffffff", "line-color": "#f4a261", "border-width": 1.5 })
    .update();
}
