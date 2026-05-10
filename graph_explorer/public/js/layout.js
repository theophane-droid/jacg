import { state } from "./state.js";
import { el } from "./dom.js";
import { sim } from "./simulation.js";

export function runLayout(name = el("layoutSelect").value, overrides = {}) {
  sim.stop();

  if (name === "cose") {
    sim.restart();
    state.cy.fit(undefined, 48);
    return;
  }

  const options = { name, animate: true, fit: true, padding: 48, ...overrides };
  if (name === "breadthfirst") Object.assign(options, { directed: true, spacingFactor: 1.25 });
  if (name === "concentric") Object.assign(options, { concentric: (node) => node.degree(false), levelWidth: () => 2 });

  const layout = state.cy.layout(options);
  layout.one("layoutstop", () => { if (el("physicsLive").checked) sim.heat(0.3); });
  layout.run();
}
