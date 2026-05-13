import { state } from "./state.js";
import { el } from "./dom.js";

export const LIVE_PHYSICS_NODE_LIMIT = 350;

export const sim = {
  alpha: 0,
  alphaDecay: 0.014,
  alphaMin: 0.002,
  velocityDecay: 0.52,
  vx: {},
  vy: {},
  rafId: null,
  running: false,
  chargeStrength: 900,
  linkStrength: 0.18,
  gravityStrength: 0.04,
  tickCount: 0,
  maxTicks: 900,

  heat(value = 0.45) {
    if (!this.canRun()) return;
    this.alpha = Math.max(this.alpha, value);
    if (!this.running) this._loop();
  },

  canRun() {
    return Boolean(
      state.cy &&
      state.cy.nodes().length <= LIVE_PHYSICS_NODE_LIMIT &&
      el("physicsLive")?.checked
    );
  },

  stop() {
    this.running = false;
    if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  },

  restart() {
    this.vx = {};
    this.vy = {};
    this.alpha = 1.0;
    this.tickCount = 0;
    this.stop();
    if (this.canRun()) this._loop();
  },

  _loop() {
    if (!this.canRun()) return;
    this.running = true;
    const tick = () => {
      if (!this.running || !state.cy || state.cy.nodes().empty() || !this.canRun()) return;
      this._applyForces();
      this.tickCount += 1;
      this.alpha *= (1 - this.alphaDecay);
      if (this.alpha < this.alphaMin || this.tickCount >= this.maxTicks) { this.running = false; return; }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  },

  _applyForces() {
    const nodeArray = state.cy.nodes().toArray();
    const edgeArray = state.cy.edges().toArray();
    const cx = state.cy.width() / 2;
    const cy = state.cy.height() / 2;
    const idealLen = state.defaultPhysics.idealEdgeLength;
    const a = this.alpha;

    for (const n of nodeArray) {
      const id = n.id();
      if (this.vx[id] === undefined) { this.vx[id] = 0; this.vy[id] = 0; }
    }

    for (let i = 0; i < nodeArray.length; i++) {
      const ni = nodeArray[i];
      const pi = ni.position();
      for (let j = i + 1; j < nodeArray.length; j++) {
        const nj = nodeArray[j];
        const pj = nj.position();
        const dx = pi.x - pj.x;
        const dy = pi.y - pj.y;
        const d2 = dx * dx + dy * dy || 1;
        const d = Math.sqrt(d2);
        const f = (this.chargeStrength * a) / d2;
        const fx = f * dx / d;
        const fy = f * dy / d;
        if (!ni.grabbed()) { this.vx[ni.id()] += fx; this.vy[ni.id()] += fy; }
        if (!nj.grabbed()) { this.vx[nj.id()] -= fx; this.vy[nj.id()] -= fy; }
      }
    }

    for (const edge of edgeArray) {
      const src = edge.source();
      const tgt = edge.target();
      if (!src.length || !tgt.length) continue;
      const ps = src.position();
      const pt = tgt.position();
      const dx = pt.x - ps.x;
      const dy = pt.y - ps.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const stretch = ((d - idealLen) / d) * this.linkStrength * a;
      const fx = stretch * dx;
      const fy = stretch * dy;
      if (!src.grabbed()) { this.vx[src.id()] += fx; this.vy[src.id()] += fy; }
      if (!tgt.grabbed()) { this.vx[tgt.id()] -= fx; this.vy[tgt.id()] -= fy; }
    }

    for (const n of nodeArray) {
      if (n.grabbed()) continue;
      const id = n.id();
      const p = n.position();
      this.vx[id] += (cx - p.x) * this.gravityStrength * a;
      this.vy[id] += (cy - p.y) * this.gravityStrength * a;
    }

    state.cy.startBatch();
    for (const n of nodeArray) {
      if (n.grabbed()) continue;
      const id = n.id();
      this.vx[id] *= this.velocityDecay;
      this.vy[id] *= this.velocityDecay;
      const p = n.position();
      n.position({ x: p.x + this.vx[id], y: p.y + this.vy[id] });
    }
    state.cy.endBatch();
  }
};

export function physicsNumber(id, scale = 1) {
  return Number(el(id).value) / scale;
}

export function syncPhysicsLabels() {
  const pairs = [
    ["physicsNodeRepulsion", "physicsNodeRepulsionValue", ""],
    ["physicsIdealEdgeLength", "physicsIdealEdgeLengthValue", ""],
    ["physicsEdgeElasticity", "physicsEdgeElasticityValue", ""],
    ["physicsGravity", "physicsGravityValue", "%"],
    ["physicsNodeOverlap", "physicsNodeOverlapValue", ""],
    ["physicsIterations", "physicsIterationsValue", ""],
    ["physicsCoolingFactor", "physicsCoolingFactorValue", "%"]
  ];
  for (const [inputId, outputId, suffix] of pairs) {
    el(outputId).textContent = `${el(inputId).value}${suffix}`;
  }
}

export function resetPhysicsControls() {
  const d = state.defaultPhysics;
  el("physicsNodeRepulsion").value = d.nodeRepulsion;
  el("physicsIdealEdgeLength").value = d.idealEdgeLength;
  el("physicsEdgeElasticity").value = d.edgeElasticity;
  el("physicsGravity").value = d.gravity;
  el("physicsNodeOverlap").value = d.nodeOverlap;
  el("physicsIterations").value = d.iterations;
  el("physicsCoolingFactor").value = d.coolingFactor;
  el("physicsAnimate").checked = d.animate;
  el("physicsLive").checked = d.live;
  syncPhysicsLabels();
}

export function syncSimParams() {
  sim.chargeStrength = physicsNumber("physicsNodeRepulsion") * 2.5;
  sim.linkStrength = physicsNumber("physicsEdgeElasticity") / 500;
  sim.gravityStrength = physicsNumber("physicsGravity", 100) * 0.002;
  sim.alphaDecay = Math.max(0.004, Math.min(0.25, 1 - physicsNumber("physicsCoolingFactor", 100)));
  sim.maxTicks = Math.max(50, Math.min(3000, physicsNumber("physicsIterations")));
  state.defaultPhysics.idealEdgeLength = physicsNumber("physicsIdealEdgeLength");
}
