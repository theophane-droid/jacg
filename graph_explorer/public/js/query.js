import { state } from "./state.js";
import { el, log } from "./dom.js";
import { api } from "./api.js";
import { LIVE_PHYSICS_NODE_LIMIT, sim } from "./simulation.js";
import { applyCaptions } from "./style.js";
import { updateControlsFromGraph } from "./controls.js";
import { runLayout } from "./layout.js";

function cloneGraph(graph) {
  return {
    nodes: [...(graph.nodes || [])],
    edges: [...(graph.edges || [])]
  };
}

export function renderGraph(graph, { pushHistory = true } = {}) {
  if (pushHistory && state.lastGraph?.nodes?.length) {
    state.graphHistory.push(cloneGraph(state.lastGraph));
    if (state.graphHistory.length > 30) state.graphHistory.shift();
  }
  state.lastGraph = graph;
  sim.stop();
  state.cy.batch(() => {
    state.cy.elements().remove();
    state.cy.add([...graph.nodes, ...graph.edges]);
  });
  updateControlsFromGraph(graph);
  applyCaptions();
  runLayout();
  if ((graph.nodes?.length || 0) > LIVE_PHYSICS_NODE_LIMIT) {
    log(`Live physics skipped for ${graph.nodes.length} nodes; using a static scalable layout.`, "ok");
  }
}

export function goBack() {
  const previous = state.graphHistory.pop();
  if (!previous) {
    log("No previous graph view.", "error");
    return;
  }
  renderGraph(previous, { pushHistory: false });
  el("nodeCount").textContent = previous.nodes.length;
  el("edgeCount").textContent = previous.edges.length;
  el("rowCount").textContent = previous.edges.length;
  log("Previous graph view restored.", "ok");
}

function renderTable(table) {
  if (!table?.rows?.length) return;
  const rows = table.rows.slice(0, 6).map((r) => JSON.stringify(r)).join("\n");
  log(`Rows preview:\n${rows}`);
}

export async function runQuery(cypher = el("cypherInput").value, paramsText = el("paramsInput").value) {
  let params = {};
  try { params = paramsText.trim() ? JSON.parse(paramsText) : {}; }
  catch (e) { log(`Invalid JSON parameters: ${e.message}`, "error"); return; }
  try {
    const data = await api("/api/query", { method: "POST", body: JSON.stringify({ cypher, params }) });
    renderGraph(data.graph);
    renderTable(data.table);
    el("nodeCount").textContent = data.summary.nodes;
    el("edgeCount").textContent = data.summary.edges;
    el("rowCount").textContent = data.summary.rows;
    log(`Query completed: ${data.summary.rows} rows, ${data.summary.nodes} nodes, ${data.summary.edges} edges`, "ok");
  } catch (e) { log(e.message, "error"); }
}

export function setPreset(preset) {
  el("cypherInput").value = preset.cypher;
  el("paramsInput").value = JSON.stringify(preset.params || {}, null, 2);
}
