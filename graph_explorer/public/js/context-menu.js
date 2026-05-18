import { state } from "./state.js";
import { el, log } from "./dom.js";
import { api, saveGraphMetadata } from "./api.js";
import { applyCaptions, applyStyle } from "./style.js";
import { updateSelection } from "./interactions.js";
import { currentTimeParams, expandNode, loadEventDetails, loadPairEvents } from "./event-graph.js";

const COLOR_PALETTE = ["#00f5d4", "#8b949e", "#6e7681", "#d29922", "#da3633", "#f0f6fc", "#30363d"];
let colorPickerTarget = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function graphKind(ele) {
  return ele.isNode() ? "node" : "edge";
}

function graphId(ele) {
  const data = ele.data();
  return data.elementId || data.neo4jId || data.identity || data.id;
}

function contextMenu() {
  return el("graphContextMenu");
}

function colorInput() {
  return el("contextColorInput");
}

export function hideContextMenu() {
  contextMenu()?.classList.add("hidden");
  state.contextTarget = null;
}

function copyToClipboard(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.focus();
  area.select();
  document.execCommand("copy");
  area.remove();
  return Promise.resolve();
}

async function updateMetadata(ele, patch) {
  const kind = graphKind(ele);
  const id = graphId(ele);
  if (!id) throw new Error("Missing graph element id.");
  await saveGraphMetadata(kind, id, patch);
  const props = { ...(ele.data("properties") || {}) };
  if (Object.prototype.hasOwnProperty.call(patch, "note")) {
    ele.data("note", patch.note || "");
    props.__graph_note = patch.note || "";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "color")) {
    ele.data("customColor", patch.color || "");
    props.__graph_color = patch.color || "";
  }
  if (Object.prototype.hasOwnProperty.call(patch, "tags")) {
    const tags = Array.isArray(patch.tags)
      ? patch.tags
      : String(patch.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);
    ele.data("tags", tags);
    props.__graph_tags = tags;
  }
  ele.data("properties", props);
  applyCaptions();
  applyStyle();
  updateSelection(ele);
}

function openNoteModal(initialValue = "") {
  return new Promise((resolve) => {
    const existing = document.querySelector(".note-modal-backdrop");
    existing?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "note-modal-backdrop";

    const modal = document.createElement("div");
    modal.className = "note-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "noteModalTitle");

    const title = document.createElement("h3");
    title.id = "noteModalTitle";
    title.textContent = "Persistent note";

    const subtitle = document.createElement("p");
    subtitle.textContent = "Stored in Neo4j metadata for this graph element.";

    const textarea = document.createElement("textarea");
    textarea.className = "note-modal-textarea";
    textarea.value = initialValue;
    textarea.placeholder = "Write an investigation note…";

    const footer = document.createElement("div");
    footer.className = "note-modal-footer";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "note-modal-button";
    cancel.textContent = "Cancel";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "note-modal-button note-modal-save";
    save.textContent = "Save note";

    footer.append(cancel, save);
    modal.append(title, subtitle, textarea, footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const close = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(value);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close(null);
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        close(textarea.value);
      }
    };

    cancel.addEventListener("click", () => close(null));
    save.addEventListener("click", () => close(textarea.value));

    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });

    document.addEventListener("keydown", onKeyDown);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  });
}
async function editNote() {
  const ele = state.contextTarget;

  if (!ele?.length) {
    log("No graph element selected", "error");
    return;
  }

  const current =
    ele.data("note") ||
    ele.data("properties")?.__graph_note ||
    "";

  const next = await openNoteModal(current);

  if (next === null) return;

  const note = next.trim();

  await updateMetadata(ele, { note });

  log(note ? "Note saved" : "Note cleared", "ok");
}

async function clearNote() {
  const ele = state.contextTarget;
  if (!ele?.length) return;
  await updateMetadata(ele, { note: "" });
  log("Note removed", "ok");
}

function validHexColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(String(value || "").trim());
}

function elementColor(ele) {
  const data = ele?.data?.() || {};
  return data.customColor || data.properties?.__graph_color || "";
}

function openCustomColorPicker() {
  const ele = state.contextTarget;
  if (!ele?.length) {
    log("No graph element selected", "error");
    return;
  }
  const input = colorInput();
  colorPickerTarget = ele;
  const current = elementColor(ele);
  input.value = validHexColor(current) ? current : "#00f5d4";
  input.click();
}

async function setElementColor(color, target = state.contextTarget) {
  const ele = target;
  if (!ele?.length) return;
  await updateMetadata(ele, { color });
  log(`${ele.isNode() ? "Node" : "Edge"} color saved`, "ok");
}

function openTagsModal(initialValue = []) {
  return new Promise((resolve) => {
    const existing = document.querySelector(".note-modal-backdrop");
    existing?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "note-modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "note-modal";
    modal.innerHTML = `
      <h3>Persistent tags</h3>
      <p>Comma-separated investigation tags stored in Neo4j metadata.</p>
      <input class="note-modal-textarea tag-modal-input" type="text" value="${escapeHtml((initialValue || []).join(", "))}" placeholder="c2, suspicious, watchlist" />
      <div class="note-modal-footer">
        <button type="button" class="note-modal-button" data-tags-cancel>Cancel</button>
        <button type="button" class="note-modal-button note-modal-save" data-tags-save>Save tags</button>
      </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    const input = modal.querySelector(".tag-modal-input");
    const close = (value) => {
      document.removeEventListener("keydown", onKeyDown);
      backdrop.remove();
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close(null);
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") close(input.value);
    };

    modal.querySelector("[data-tags-cancel]")?.addEventListener("click", () => close(null));
    modal.querySelector("[data-tags-save]")?.addEventListener("click", () => close(input.value));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) close(null);
    });
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => input.focus());
  });
}

async function editTags() {
  const ele = state.contextTarget;
  if (!ele?.length) return;
  const current = ele.data("tags") || ele.data("properties")?.__graph_tags || [];
  const next = await openTagsModal(Array.isArray(current) ? current : String(current || "").split(","));
  if (next === null) return;
  const tags = String(next || "").split(",").map((tag) => tag.trim()).filter(Boolean);
  await updateMetadata(ele, { tags });
  log(tags.length ? "Tags saved" : "Tags cleared", "ok");
}

async function copyElement() {
  const ele = state.contextTarget;
  if (!ele?.length) return;
  await copyToClipboard(ele.data());
  log(`${ele.isNode() ? "Node" : "Edge"} copied to clipboard`, "ok");
}

function hideNode() {
  const ele = state.contextTarget;
  if (!ele?.length || !ele.isNode()) return;
  const label = ele.data("caption") || ele.data("label") || ele.id();
  ele.hide();
  updateSelection(null);
  log(`Node hidden: ${label}`, "ok");
}

function showHiddenNodes() {
  if (!state.cy) return;
  const hidden = state.cy.elements(":hidden");
  hidden.show();
  log(`${hidden.length} hidden graph element(s) restored`, "ok");
}

function fmt(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n.toLocaleString("fr-FR") : String(value || "0");
}

function fmtDate(value) {
  if (!value) return "n/a";
  const date = new Date(String(value));
  if (Number.isNaN(date.valueOf())) return String(value);
  return date.toLocaleString("fr-FR");
}

function fmtTimelineDate(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.valueOf())) return String(value || "");
  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function timelineBucketStart(bucket) {
  const date = new Date(String(bucket?.bucket || bucket || ""));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function timelineBucketEnd(bucket, stepMs) {
  const start = timelineBucketStart(bucket);
  return start ? new Date(start.getTime() + Number(stepMs || 3600000)) : null;
}

function renderList(items, renderItem) {
  if (!items?.length) return `<div class="node-stats-empty">No data</div>`;
  return items.map(renderItem).join("");
}

function renderStaticTimeline(timeline = {}) {
  const buckets = timeline.buckets || [];
  if (!buckets.length) return `<div class="node-stats-empty">No timeline data</div>`;
  const stepMs = Number(timeline.step?.ms || 3600000);
  const bounds = timeline.bounds || {};
  const first = bounds.from ? new Date(String(bounds.from)) : timelineBucketStart(buckets[0]);
  const middle = timelineBucketStart(buckets[Math.floor((buckets.length - 1) / 2)]);
  const last = bounds.to ? new Date(String(bounds.to)) : timelineBucketEnd(buckets[buckets.length - 1], stepMs);
  const axis = [
    [first, 0],
    [middle, 50],
    [last, 100]
  ]
    .filter(([date]) => date && !Number.isNaN(date.valueOf()))
    .map(([date, left]) => `<span style="left:${left}%">${escapeHtml(fmtTimelineDate(date))}</span>`)
    .join("");
  const max = buckets.reduce((m, b) => Math.max(m, Number(b.count || 0)), 1);
  const bars = buckets.map((bucket) => {
    const count = Number(bucket.count || 0);
    const height = count > 0 ? Math.max(4, Math.round((count / max) * 42)) : 0;
    const date = fmtDate(bucket.bucket);
    return `<span class="node-stats-timeline-bucket${count <= 0 ? " empty" : ""}" style="height:${height}px" title="${date} · ${fmt(count)} events"></span>`;
  }).join("");
  return `
    <div class="node-stats-timeline-meta">
      <span>Dataset range ${escapeHtml(fmtTimelineDate(first))} → ${escapeHtml(fmtTimelineDate(last))}</span>
      <span>${fmt(buckets.length)} buckets · ${escapeHtml(timeline.step?.label || "auto")}</span>
    </div>
    <div class="node-stats-timeline" aria-label="Dataset-aligned event timeline">
      <div class="node-stats-timeline-axis">${axis}</div>
      ${bars}
    </div>
  `;
}

function fmtBytes(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return String(value || "0");
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${Math.round(n).toLocaleString("fr-FR")} B`;
}

function sampleField(properties = {}, candidates = []) {
  for (const field of candidates) {
    const value = properties?.[field];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function openEdgeStatsModal(payload) {
  const existing = document.querySelector(".node-stats-backdrop");
  existing?.remove();

  const summary = payload.summary || {};
  const grouped = {};
  for (const row of payload.breakdowns || []) {
    grouped[row.field] ||= [];
    grouped[row.field].push(row);
  }

  const backdrop = document.createElement("div");
  backdrop.className = "node-stats-backdrop";
  backdrop.innerHTML = `
    <section class="node-stats-modal edge-stats-modal" role="dialog" aria-modal="true" aria-labelledby="edgeStatsTitle">
      <header class="node-stats-header">
        <div>
          <h3 id="edgeStatsTitle">Edge statistics</h3>
          <p>${escapeHtml(summary.source || "source")} → ${escapeHtml(summary.target || "target")}</p>
        </div>
        <button type="button" class="node-stats-close" aria-label="Close">×</button>
      </header>

      <div class="node-stats-grid">
        <div><strong>${fmt(summary.event_count)}</strong><span>Events</span></div>
        <div><strong>${fmtBytes(summary.total_bytes)}</strong><span>Total bytes</span></div>
        <div><strong>${fmtBytes(summary.avg_bytes)}</strong><span>Avg bytes</span></div>
        <div><strong>${fmtBytes(summary.bytes_per_second)}/s</strong><span>Throughput</span></div>
      </div>

      <div class="node-stats-meta">
        <div><span>First seen</span><strong>${fmtDate(summary.first_seen)}</strong></div>
        <div><span>Last seen</span><strong>${fmtDate(summary.last_seen)}</strong></div>
      </div>

      <section class="node-stats-timeline-section">
        <h4>Event timeline</h4>
        ${renderStaticTimeline(payload.timeline)}
      </section>

      <div class="node-stats-columns">
        ${Object.entries(grouped).map(([field, rows]) => `
          <section>
            <h4>${field}</h4>
            ${renderList(rows.slice(0, 10), (item) => `
              <article class="node-stats-row">
                <strong>${escapeHtml(item.value ?? "unknown")}</strong>
                <span>${fmt(item.events)} events · ${fmtBytes(item.bytes)}</span>
              </article>`)}
          </section>`).join("")}
      </div>

      <section class="node-stats-timeline-section">
        <h4>Recent events</h4>
        ${renderList(payload.samples || [], (item) => `
          <article class="node-stats-row">
            <strong>${fmtDate(item.ts_datetime)}</strong>
            <span>${[
              sampleField(item.properties, ["service", "event_type", "type", "action", "proto"]),
              sampleField(item.properties, ["id_resp_p", "destination_port", "dst_port", "port"]),
              fmtBytes(item.bytes)
            ].filter(Boolean).map(escapeHtml).join(" · ")}</span>
            <small>${escapeHtml(sampleField(item.properties, ["uid", "event_id", "id", "source_file", "log_type"]))}</small>
          </article>`)}
      </section>
    </section>
  `;

  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  backdrop.querySelector(".node-stats-close")?.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(backdrop);
}

function openNodeStatsModal(payload) {
  const existing = document.querySelector(".node-stats-backdrop");
  existing?.remove();

  const summary = payload.summary || {};
  const grouped = {};
  for (const row of payload.breakdowns || []) {
    const key = row.direction ? `${row.field} · ${row.direction}` : row.field;
    grouped[key] ||= [];
    grouped[key].push(row);
  }
  const backdrop = document.createElement("div");
  backdrop.className = "node-stats-backdrop";
  backdrop.innerHTML = `
    <section class="node-stats-modal" role="dialog" aria-modal="true" aria-labelledby="nodeStatsTitle">
      <header class="node-stats-header">
        <div>
          <h3 id="nodeStatsTitle">Node statistics</h3>
          <p>${summary.node || "selected node"}</p>
        </div>
        <button type="button" class="node-stats-close" aria-label="Close">×</button>
      </header>

      <div class="node-stats-grid">
        <div><strong>${fmt(summary.total_events)}</strong><span>Total events</span></div>
        <div><strong>${fmt(summary.outbound_events)}</strong><span>Outbound</span></div>
        <div><strong>${fmt(summary.inbound_events)}</strong><span>Inbound</span></div>
        <div><strong>${fmt(summary.total_neighbors)}</strong><span>Neighbors</span></div>
        <div><strong>${fmtBytes(summary.total_bytes)}</strong><span>Total bytes</span></div>
        <div><strong>${fmtBytes(summary.outbound_bytes)}</strong><span>Outbound bytes</span></div>
        <div><strong>${fmtBytes(summary.inbound_bytes)}</strong><span>Inbound bytes</span></div>
        <div><strong>${fmt(summary.total_duration)}</strong><span>Duration</span></div>
      </div>

      <div class="node-stats-meta">
        <div><span>First seen</span><strong>${fmtDate(summary.first_seen)}</strong></div>
        <div><span>Last seen</span><strong>${fmtDate(summary.last_seen)}</strong></div>
      </div>

      <section class="node-stats-timeline-section">
        <h4>Event timeline</h4>
        ${renderStaticTimeline(payload.timeline)}
      </section>

      <div class="node-stats-columns">
        <section>
          <h4>Top neighbors</h4>
          ${renderList(payload.topNeighbors, (item) => `
            <article class="node-stats-row">
              <strong>${item.neighbor}</strong>
              <span>${item.direction} · ${fmt(item.events)} events · ${fmtBytes(item.bytes)}</span>
              <small>${item.label || "entity"}</small>
            </article>`)}
        </section>
        <section>
          <h4>Event breakdowns</h4>
          ${renderList(Object.entries(grouped).slice(0, 8), ([field, rows]) => `
            <article class="node-stats-row">
              <strong>${escapeHtml(field)}</strong>
              <span>${rows.slice(0, 4).map((item) => `${escapeHtml(item.value ?? "unknown")} (${fmt(item.events)})`).join(" · ")}</span>
              <small>${fmtBytes(rows.reduce((sum, item) => sum + Number(item.bytes || 0), 0))}</small>
            </article>`)}
        </section>
      </div>

      <section class="node-stats-timeline-section">
        <h4>Recent events</h4>
        ${renderList(payload.samples || [], (item) => `
          <article class="node-stats-row">
            <strong>${fmtDate(item.ts_datetime)}</strong>
            <span>${[
              item.direction,
              item.neighbor,
              sampleField(item.properties, ["service", "event_type", "type", "action", "proto"]),
              sampleField(item.properties, ["id_resp_p", "destination_port", "dst_port", "port"]),
              fmtBytes(item.bytes)
            ].filter(Boolean).map(escapeHtml).join(" · ")}</span>
            <small>${escapeHtml(sampleField(item.properties, ["uid", "event_id", "id", "source_file", "log_type"]))}</small>
          </article>`)}
      </section>
    </section>
  `;

  const close = () => {
    document.removeEventListener("keydown", onKeyDown);
    backdrop.remove();
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") close();
  };

  backdrop.querySelector(".node-stats-close")?.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onKeyDown);
  document.body.appendChild(backdrop);
}

async function showNodeStats() {
  const ele = state.contextTarget;
  if (!ele?.length || !ele.isNode()) return;
  const query = currentTimeParams();
  const payload = await api(`/api/graph/node/${encodeURIComponent(ele.id())}/stats?${query}`);
  openNodeStatsModal(payload);
}

async function showEdgeStats() {
  const ele = state.contextTarget;
  if (!ele?.length || !ele.isEdge()) return;
  const data = ele.data();
  if (!data.source_value || !data.destination_value) {
    log("Edge statistics require an aggregated source → destination edge.", "error");
    return;
  }
  const query = currentTimeParams({
    source: data.source_value,
    target: data.destination_value,
    sourceLabel: data.source_label || "",
    targetLabel: data.target_label || "",
    groupBy: data.aggregate_mode || "pair",
    aggregateValue: data.aggregate_value || ""
  });
  const payload = await api(`/api/graph/edge/stats?${query}`);
  openEdgeStatsModal(payload);
}

function renderColorButtons(menu) {
  const wrap = menu.querySelector("[data-context-colors]");
  if (!wrap) return;
  wrap.innerHTML = "";
  for (const color of COLOR_PALETTE) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "context-color-swatch";
    button.style.backgroundColor = color;
    button.title = color;
    button.addEventListener("click", async () => {
      try { await setElementColor(color); hideContextMenu(); }
      catch (e) { log(e.message, "error"); }
    });
    wrap.appendChild(button);
  }
}

export function createContextMenu() {
  if (contextMenu()) return;
  const menu = document.createElement("div");
  menu.id = "graphContextMenu";
  menu.className = "graph-context-menu hidden";
  menu.innerHTML = `
    <div class="context-section context-background-only">
      <div class="context-section-title">Map</div>
      <button type="button" data-context-action="show-hidden">Show hidden nodes</button>
    </div>

    <div class="context-section context-node-only">
      <div class="context-section-title">Investigate</div>
      <button type="button" data-context-action="node-stats">Statistics</button>
      <button type="button" class="context-entity-only" data-context-action="expand-neighbors">Expand neighbors</button>
      <button type="button" class="context-entity-only" data-context-action="expand-neighbors-append">Expand neighbors here</button>
      <button type="button" class="context-entity-only" data-context-action="outbound-events">Outbound aggregate</button>
      <button type="button" class="context-entity-only" data-context-action="inbound-events">Inbound aggregate</button>
      <button type="button" class="context-event-only" data-context-action="event-details">Event details</button>
    </div>

    <div class="context-section context-edge-only">
      <div class="context-section-title">Edge</div>
      <button type="button" data-context-action="edge-stats">Statistics</button>
      <button type="button" data-context-action="underlying-events">Underlying events</button>
    </div>

    <div class="context-section context-element-only">
      <div class="context-section-title">Annotate</div>
      <button type="button" data-context-action="note">Add / edit note</button>
      <button type="button" data-context-action="tags">Add / edit tags</button>
      <button type="button" data-context-action="clear-note">Clear note</button>
    </div>

    <div class="context-section context-element-only">
      <div class="context-section-title">Visual</div>
      <div class="context-color-grid" data-context-colors></div>
      <button type="button" data-context-action="custom-color">Custom color…</button>
      <button type="button" data-context-action="reset-color">Reset color</button>
    </div>

    <div class="context-section context-node-only">
      <div class="context-section-title">Map hygiene</div>
      <button type="button" data-context-action="hide-node">Hide node</button>
    </div>

    <div class="context-section context-element-only">
      <div class="context-section-title">Data</div>
      <button type="button" data-context-action="copy">Copy JSON</button>
    </div>
  `;
  document.body.appendChild(menu);

  const input = document.createElement("input");
  input.id = "contextColorInput";
  input.type = "color";
  input.className = "context-color-input";
  document.body.appendChild(input);

  renderColorButtons(menu);

  menu.addEventListener("click", async (e) => {
    e.stopPropagation();

    const action = e.target.closest("[data-context-action]")?.dataset.contextAction;
    if (!action) return;

    try {
      if (action === "copy") await copyElement();
      if (action === "expand-neighbors") await expandNode(state.contextTarget, "both");
      if (action === "expand-neighbors-append") await expandNode(state.contextTarget, "both", { append: true });
      if (action === "outbound-events") await expandNode(state.contextTarget, "outbound");
      if (action === "inbound-events") await expandNode(state.contextTarget, "inbound");
      if (action === "event-details") await loadEventDetails(state.contextTarget);
      if (action === "underlying-events") await loadPairEvents(state.contextTarget);
      if (action === "node-stats") await showNodeStats();
      if (action === "edge-stats") await showEdgeStats();
      if (action === "hide-node") hideNode();
      if (action === "show-hidden") showHiddenNodes();
      if (action === "note") await editNote();
      if (action === "tags") await editTags();
      if (action === "clear-note") await clearNote();
      if (action === "custom-color") openCustomColorPicker();
      if (action === "reset-color") await setElementColor("");

      if (action !== "custom-color") hideContextMenu();
    } catch (err) {
      log(err.message, "error");
    }
  });

  input.addEventListener("change", async () => {
    try {
      await setElementColor(input.value, colorPickerTarget || state.contextTarget);
      hideContextMenu();
    } catch (err) {
      log(err.message, "error");
    } finally {
      colorPickerTarget = null;
    }
  });

  window.addEventListener("click", (e) => {
    if (e.target.closest(".note-modal-backdrop") || e.target.closest(".node-stats-backdrop")) return;
    if (!contextMenu()?.contains(e.target)) hideContextMenu();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideContextMenu();
  });
}

function positionContextMenu(menu, renderedPosition) {
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - 240, renderedPosition.x + 12))}px`;
  menu.style.top = `${Math.max(8, Math.min(window.innerHeight - 320, renderedPosition.y + 12))}px`;
  menu.classList.remove("hidden");
}

export function showCanvasContextMenu(renderedPosition) {
  createContextMenu();
  state.contextTarget = null;
  const menu = contextMenu();
  menu.querySelectorAll(".context-background-only").forEach((item) => item.classList.remove("hidden"));
  menu.querySelectorAll(".context-element-only, .context-node-only, .context-entity-only, .context-event-only, .context-edge-only").forEach((item) => item.classList.add("hidden"));
  menu.setAttribute("aria-label", "Map context menu");
  positionContextMenu(menu, renderedPosition);
}

export function showContextMenu(ele, renderedPosition) {
  createContextMenu();
  state.contextTarget = ele;
  updateSelection(ele);

  const menu = contextMenu();
  const isNode = ele.isNode();
  const isEvent = isNode && ele.hasClass("event");
  menu.querySelectorAll(".context-background-only").forEach((item) => item.classList.add("hidden"));
  menu.querySelectorAll(".context-element-only").forEach((item) => item.classList.remove("hidden"));
  menu.querySelectorAll(".context-node-only").forEach((item) => item.classList.toggle("hidden", !isNode));
  menu.querySelectorAll(".context-entity-only").forEach((item) => item.classList.toggle("hidden", !isNode || isEvent));
  menu.querySelectorAll(".context-event-only").forEach((item) => item.classList.toggle("hidden", !isEvent));
  menu.querySelectorAll(".context-edge-only").forEach((item) => item.classList.toggle("hidden", isNode));
  const data = ele.data();
  const title = `${isNode ? "Node" : "Edge"} · ${data.caption || data.type || data.id}`;
  menu.setAttribute("aria-label", title);
  positionContextMenu(menu, renderedPosition);
}
