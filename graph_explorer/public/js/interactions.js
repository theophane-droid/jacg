import { state } from "./state.js";
import { el, log } from "./dom.js";
import { propertyValue } from "./style.js";
import { runQuery } from "./query.js";

export function selectedData() {
  const selected = state.cy.$(":selected").first();
  return selected.length ? selected.data() : null;
}

export function updateSelection(element) {
  state.selected = element;
  const selectionBar = el("selectionBar");
  if (!element?.length) {
    selectionBar?.classList.add("hidden");
    el("selectionText").textContent = "";
    el("inspector").textContent = "";
    return;
  }
  selectionBar?.classList.remove("hidden");
  const data = element.data();
  const props = data.properties || {};
  const note = data.note || props.__graph_note || "";
  const color = data.customColor || props.__graph_color || "";
  const tags = data.tags || props.__graph_tags || [];
  el("selectionText").textContent = element.isNode()
    ? `Node ${data.caption || data.id}${note ? " · note" : ""}${tags.length ? " · tags" : ""}`
    : `Edge ${data.type || data.caption}${note ? " · note" : ""}${tags.length ? " · tags" : ""}`;
  el("inspector").textContent = JSON.stringify({ ...data, note, customColor: color, tags, properties: props }, null, 2);
  const pivotField = el("pivotField").value;
  const value = propertyValue(data, pivotField);
  if (value !== "") el("pivotValue").value = value;
}

export function highlightNeighborhood(node) {
  if (!node?.length) return;
  const nb = node.closedNeighborhood();
  state.cy.elements().addClass("faded").removeClass("highlighted focus-node");
  nb.removeClass("faded").addClass("highlighted");
  node.addClass("focus-node");
}

export function clearHighlight() {
  state.cy.elements().removeClass("faded highlighted focus-node");
}

export function runPivot() {
  const target = el("pivotTarget").value;
  const field = el("pivotField").value;
  const value = el("pivotValue").value;
  const limit = Number(el("pivotLimit").value || 300);
  if (!field || value === "") { log("Pivot field and value are required.", "error"); return; }
  const cypher = target === "edge"
    ? "MATCH p=(a)-[r]-(b) WHERE r[$field] = $value RETURN p LIMIT $limit"
    : "MATCH p=(n)-[r]-(m) WHERE n[$field] = $value RETURN p LIMIT $limit";
  el("cypherInput").value = cypher;
  el("paramsInput").value = JSON.stringify({ field, value, limit }, null, 2);
  runQuery();
}

export function runAggregation() {
  const target = el("aggregateTarget").value;
  const field = el("aggregateField").value;
  const metric = el("metricField").value;
  const params = { field, metric, limit: 100 };
  let cypher;
  if (target === "relationship") {
    cypher = "MATCH ()-[r]->() RETURN type(r) AS group, count(r) AS count ORDER BY count DESC LIMIT $limit";
  } else if (target === "node") {
    cypher = "MATCH (n) WHERE n[$field] IS NOT NULL RETURN n[$field] AS group, count(n) AS count ORDER BY count DESC LIMIT $limit";
  } else if (metric === "__count") {
    cypher = "MATCH ()-[r]->() WHERE r[$field] IS NOT NULL RETURN r[$field] AS group, count(r) AS count ORDER BY count DESC LIMIT $limit";
  } else {
    cypher = "MATCH ()-[r]->() WHERE r[$field] IS NOT NULL AND r[$metric] IS NOT NULL RETURN r[$field] AS group, count(r) AS rows, sum(toFloat(r[$metric])) AS sum, avg(toFloat(r[$metric])) AS avg ORDER BY rows DESC LIMIT $limit";
  }
  el("cypherInput").value = cypher;
  el("paramsInput").value = JSON.stringify(params, null, 2);
  runQuery();
}
