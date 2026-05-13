import { state } from "./state.js";
import { el } from "./dom.js";
import { LIVE_PHYSICS_NODE_LIMIT, compactGraphPositions, sim } from "./simulation.js";

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

  const options = {
    name: layoutName,
    animate: false,
    fit: true,
    padding: 48,
    ...overrides
  };
  if (layoutName === "cose") Object.assign(options, {
    randomize: true,
    idealEdgeLength: Number(el("physicsIdealEdgeLength")?.value || 115),
    nodeRepulsion: Number(el("physicsNodeRepulsion")?.value || 11000),
    gravity: Number(el("physicsGravity")?.value || 18) / 100,
    numIter: Math.min(1200, Number(el("physicsIterations")?.value || 600)),
    componentSpacing: 90,
    nestingFactor: 1.2
  });
  if (layoutName === "breadthfirst") Object.assign(options, { directed: true, spacingFactor: nodeCount > 450 ? 0.95 : 1.25 });
  if (layoutName === "concentric") Object.assign(options, { concentric: (node) => node.degree(false), levelWidth: () => 2 });
  if (layoutName === "grid") Object.assign(options, { avoidOverlap: true, condense: false });

  const layout = state.cy.layout(options);
  layout.one("layoutstop", () => {
    compactGraphPositions();
    state.cy.fit(undefined, 48);
    if (layoutName !== "cose" && nodeCount <= LIVE_PHYSICS_NODE_LIMIT) sim.heat(0.2);
  });
  layout.run();
}
