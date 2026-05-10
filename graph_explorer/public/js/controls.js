import { state } from "./state.js";
import { el } from "./dom.js";
import { api } from "./api.js";

export function updateSelect(select, values, extra = []) {
  const current = select.value;
  select.innerHTML = "";
  for (const item of extra.concat(values)) {
    const option = document.createElement("option");
    option.value = item.value ?? item;
    option.textContent = item.label ?? item;
    select.appendChild(option);
  }
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

export function updateControlsFromGraph(graph) {
  const nodeFields = new Set(["label", "caption", "display", "name", "value", "__note", "__tags"]);
  const edgeFields = new Set(["label", "caption", "display", "name", "type", "event_count", "total_bytes", "avg_bytes", "total_duration", "avg_duration", "bytes_per_second", "first_seen", "last_seen", "services", "destination_ports", "__note", "__tags"]);
  for (const node of graph.nodes) {
    for (const key of Object.keys(node.data || {})) nodeFields.add(key);
    for (const key of Object.keys(node.data.properties || {})) nodeFields.add(key);
  }
  for (const edge of graph.edges) {
    for (const key of Object.keys(edge.data || {})) edgeFields.add(key);
    for (const key of Object.keys(edge.data.properties || {})) edgeFields.add(key);
  }
  for (const key of state.schema.propertyKeys) { nodeFields.add(key); edgeFields.add(key); }

  updateSelect(el("nodeLabelField"), [...nodeFields].sort(), [{ value: "__labels", label: "labels" }]);
  updateSelect(el("edgeLabelField"), [...edgeFields].sort(), [{ value: "__type", label: "type" }]);
  if (!el("nodeLabelFieldsInput").value.trim()) el("nodeLabelFieldsInput").value = "caption";
  if (!el("edgeLabelFieldsInput").value.trim()) el("edgeLabelFieldsInput").value = "caption";
  updateSelect(el("nodeSizeField"), [...nodeFields].sort(), [{ value: "__none", label: "degree" }]);
  updateSelect(el("edgeWidthField"), [...edgeFields].sort(), [{ value: "__none", label: "auto/event count" }]);
  updateSelect(el("pivotField"), [...new Set([...nodeFields, ...edgeFields])].sort());
  updateSelect(el("aggregateField"), [...new Set([...nodeFields, ...edgeFields])].sort());
  updateSelect(el("metricField"), [...edgeFields].sort(), [{ value: "__count", label: "count" }]);
}

export async function loadSchema() {
  const schema = await api("/api/schema");
  state.schema = schema;
  const allFields = [...new Set(["label", "caption", "display", "name", "value", "event_count", "total_bytes", "avg_bytes", "total_duration", "avg_duration", "bytes_per_second", "first_seen", "last_seen", "services", "destination_ports", "__note", "__tags", ...schema.propertyKeys])].sort();
  updateSelect(el("nodeLabelField"), allFields, [{ value: "__labels", label: "labels" }]);
  updateSelect(el("edgeLabelField"), allFields, [{ value: "__type", label: "type" }]);
  if (!el("nodeLabelFieldsInput").value.trim()) el("nodeLabelFieldsInput").value = "caption";
  if (!el("edgeLabelFieldsInput").value.trim()) el("edgeLabelFieldsInput").value = "caption";
  updateSelect(el("pivotField"), allFields);
  updateSelect(el("aggregateField"), allFields);
  updateSelect(el("metricField"), allFields, [{ value: "__count", label: "count" }]);
}
