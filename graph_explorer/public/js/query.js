import { state } from "./state.js";
import { el, log } from "./dom.js";
import { api } from "./api.js";
import { sim } from "./simulation.js";
import { applyCaptions } from "./style.js";
import { updateControlsFromGraph } from "./controls.js";

export function renderGraph(graph) {
  state.lastGraph = graph;
  state.cy.elements().remove();
  state.cy.add([...graph.nodes, ...graph.edges]);
  updateControlsFromGraph(graph);
  applyCaptions();
  state.cy.nodes().forEach((n) => {
    n.position({
      x: state.cy.width() / 2 + (Math.random() - 0.5) * 400,
      y: state.cy.height() / 2 + (Math.random() - 0.5) * 400
    });
  });
  sim.restart();
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
