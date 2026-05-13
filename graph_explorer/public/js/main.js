import { state } from "./state.js";
import { el, log } from "./dom.js";
import { api } from "./api.js";
import { runLayout } from "./layout.js";
import { appendDisplayField, applyCaptions, applyStyle, updateLabelVisibility } from "./style.js";
import { resetPhysicsControls, sim, syncPhysicsLabels, syncSimParams } from "./simulation.js";
import { loadSchema } from "./controls.js";
import { goBack, runQuery, setPreset } from "./query.js";
import { updateSuggestions } from "./cypher.js";
import { clearHighlight, highlightNeighborhood, runAggregation, runPivot, selectedData, updateSelection } from "./interactions.js";
import { createContextMenu, hideContextMenu, showCanvasContextMenu, showContextMenu } from "./context-menu.js";
import { bindEventGraphControls, expandNode, loadAggregate, loadEventDetails, loadGraphConfig, loadPairEvents } from "./event-graph.js";

async function refreshConnectionStatus() {
  const health = await api("/api/health");
  el("connectionStatus").textContent = `Neo4j ${health.database} at ${health.neo4jUri}`;
  el("connectionStatus").className = "status ok";
  return health;
}

async function loadDatabases() {
  const select = el("databaseSelect");
  if (!select) return;
  try {
    const data = await api("/api/databases");
    select.innerHTML = "";
    for (const db of data.databases || []) {
      const option = document.createElement("option");
      option.value = db.name;
      option.textContent = db.name === data.defaultDatabase ? `${db.name} (default)` : db.name;
      select.appendChild(option);
    }
    if ([...select.options].some((option) => option.value === data.activeDatabase)) {
      select.value = data.activeDatabase;
    }
  } catch (error) {
    select.innerHTML = "";
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "database unavailable";
    select.appendChild(option);
    log(`Cannot list Neo4j databases: ${error.message}`, "error");
  }
}

async function changeDatabase(database) {
  if (!database) return;
  try {
    await api("/api/database", {
      method: "POST",
      body: JSON.stringify({ database })
    });
    await refreshConnectionStatus();
    await loadSchema();
    await loadGraphConfig();
    state.cy.elements().remove();
    updateSelection(null);
    await loadAggregate();
    log(`Database switched to ${database}`, "ok");
  } catch (error) {
    log(`Cannot switch database: ${error.message}`, "error");
    await loadDatabases();
  }
}

async function init() {
  state.cy = cytoscape({
    container: el("cy"),
    elements: [],
    userZoomingEnabled: true,
    wheelSensitivity: 0.7,
    minZoom: 0.08,
    maxZoom: 4
  });

  createContextMenu();

  state.cy.on("tap", "node, edge", (e) => updateSelection(e.target));
  state.cy.on("dbltap", "node", (e) => e.target.hasClass("event") ? loadEventDetails(e.target) : expandNode(e.target, "both"));
  state.cy.on("dbltap", "edge.virtual", (e) => loadPairEvents(e.target));
  state.cy.on("tap", (e) => {
    hideContextMenu();
    if (e.target === state.cy) updateSelection(null);
  });
  state.cy.on("mouseover", "node", (e) => highlightNeighborhood(e.target));
  state.cy.on("mouseout", "node", clearHighlight);
  state.cy.on("zoom", updateLabelVisibility);
  state.cy.on("grab", "node", () => { if (el("physicsLive").checked) sim.heat(0.5); });
  state.cy.on("cxttap", "node, edge", (e) => {
    e.originalEvent?.preventDefault?.();
    showContextMenu(e.target, e.renderedPosition);
  });
  state.cy.on("cxttap", (e) => {
    if (e.target !== state.cy) return;
    e.originalEvent?.preventDefault?.();
    showCanvasContextMenu(e.renderedPosition || { x: e.originalEvent?.clientX || 0, y: e.originalEvent?.clientY || 0 });
  });
  el("cy").addEventListener("contextmenu", (e) => e.preventDefault());

  el("runButton").addEventListener("click", () => runQuery());
  el("graphBackButton").addEventListener("click", goBack);
  el("schemaButton").addEventListener("click", () => loadSchema().then(() => log("Schema refreshed", "ok")));
  el("layoutButton").addEventListener("click", () => runLayout());
  el("zoomInButton").addEventListener("click", () => {
    state.cy.zoom({ level: Math.min(state.cy.maxZoom(), state.cy.zoom() * 1.22), renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } });
  });
  el("zoomOutButton").addEventListener("click", () => {
    state.cy.zoom({ level: Math.max(state.cy.minZoom(), state.cy.zoom() / 1.22), renderedPosition: { x: state.cy.width() / 2, y: state.cy.height() / 2 } });
  });
  el("fitButton").addEventListener("click", () => state.cy.fit(undefined, 48));
  el("clearButton").addEventListener("click", () => {
    sim.stop();
    state.graphHistory = [];
    state.lastGraph = { nodes: [], edges: [] };
    state.cy.elements().remove();
    el("physicsNotice")?.classList.add("hidden");
    updateSelection(null);
  });
  el("toggleQueryPanelButton").addEventListener("click", () => {
    document.body.classList.toggle("query-collapsed");
    window.setTimeout(() => state.cy.resize().fit(undefined, 48), 180);
  });
  el("toggleToolsPanelButton").addEventListener("click", () => {
    document.body.classList.toggle("tools-collapsed");
    window.setTimeout(() => state.cy.resize().fit(undefined, 48), 180);
  });
  el("applyStyleButton").addEventListener("click", applyCaptions);
  el("nodeLabelField").addEventListener("change", () => {
    const value = el("nodeLabelField").value;
    if (value && value !== "__none") el("nodeLabelFieldsInput").value = value;
    applyCaptions();
  });
  el("edgeLabelField").addEventListener("change", () => {
    const value = el("edgeLabelField").value;
    if (value && value !== "__none") el("edgeLabelFieldsInput").value = value;
    applyCaptions();
  });
  el("nodeLabelFieldsInput").addEventListener("input", applyCaptions);
  el("edgeLabelFieldsInput").addEventListener("input", applyCaptions);
  el("labelsToggleButton").addEventListener("click", () => { state.labelsVisible = !state.labelsVisible; applyStyle(); });

  for (const id of [
    "physicsNodeRepulsion", "physicsIdealEdgeLength", "physicsEdgeElasticity",
    "physicsGravity", "physicsNodeOverlap", "physicsIterations", "physicsCoolingFactor"
  ]) {
    el(id).addEventListener("input", () => { syncPhysicsLabels(); syncSimParams(); });
  }

  el("physicsRunButton").addEventListener("click", () => { syncSimParams(); sim.restart(); });
  el("physicsResetButton").addEventListener("click", () => { resetPhysicsControls(); syncSimParams(); sim.restart(); });
  el("physicsLive").addEventListener("change", () => {
    if (el("physicsLive").checked) sim.heat(0.4);
    else sim.stop();
  });

  el("pivotButton").addEventListener("click", runPivot);
  el("aggregateButton").addEventListener("click", runAggregation);
  el("cypherInput").addEventListener("input", updateSuggestions);
  el("cypherInput").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") runQuery();
    if (e.key === "Escape") el("suggestions").classList.add("hidden");
  });
  el("pivotField").addEventListener("change", () => {
    const data = selectedData();
    if (!data) return;
    const value = data[el("pivotField").value] ?? data.properties?.[el("pivotField").value] ?? "";
    if (value !== "") el("pivotValue").value = value;
  });

  bindEventGraphControls();

  resetPhysicsControls();
  syncSimParams();

  try {
    await refreshConnectionStatus();
    await loadDatabases();
    el("databaseSelect")?.addEventListener("change", (event) => changeDatabase(event.target.value));
  } catch (e) {
    el("connectionStatus").textContent = `Neo4j unavailable: ${e.message}`;
    el("connectionStatus").className = "status error";
  }

  try {
    await loadSchema();
    await loadGraphConfig();
    const presetData = await api("/api/presets");
    state.presets = presetData.presets;
    const select = el("presetSelect");
    for (const preset of state.presets) {
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = preset.name;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      const preset = state.presets.find((p) => p.id === select.value);
      if (preset) setPreset(preset);
    });
    if (state.presets[0]) setPreset(state.presets[0]);
    await loadAggregate();
    log("Ready", "ok");
  } catch (e) { log(e.message, "error"); }
}

init();
