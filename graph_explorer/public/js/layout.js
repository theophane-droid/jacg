import { state } from "./state.js";
import { el } from "./dom.js";
import { LIVE_PHYSICS_NODE_LIMIT, sim } from "./simulation.js";

function effectiveLayout(name, nodeCount) {
  if (name !== "cose") return name;
  if (nodeCount > 900) return "grid";
  if (nodeCount > LIVE_PHYSICS_NODE_LIMIT) return "breadthfirst";
  return name;
}

export function runLayout(name = el("layoutSelect").value, overrides = {}) {
  sim.stop();
  const nodeCount = state.cy?.nodes().length || 0;
  const layoutName = effectiveLayout(name, nodeCount);

  if (layoutName === "cose") {
    sim.restart();
    state.cy.fit(undefined, 48);
    return;
  }

  const options = {
    name: layoutName,
    animate: nodeCount <= 450,
    fit: true,
    padding: 48,
    ...overrides
  };
  if (layoutName === "breadthfirst") Object.assign(options, { directed: true, spacingFactor: nodeCount > 450 ? 0.95 : 1.25 });
  if (layoutName === "concentric") Object.assign(options, { concentric: (node) => node.degree(false), levelWidth: () => 2 });
  if (layoutName === "grid") Object.assign(options, { avoidOverlap: true, condense: false });

  const layout = state.cy.layout(options);
  layout.one("layoutstop", () => { if (nodeCount <= LIVE_PHYSICS_NODE_LIMIT) sim.heat(0.3); });
  layout.run();
}
