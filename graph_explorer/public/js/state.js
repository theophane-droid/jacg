export const state = {
  cy: null,
  schema: { labels: [], relationshipTypes: [], propertyKeys: [] },
  presets: [],
  selected: null,
  labelsVisible: true,
  lastGraph: { nodes: [], edges: [] },
  graphHistory: [],
  contextTarget: null,
  graphConfig: { entityLabel: "IP", eventLabel: "Event", aggregateModes: [], widthMetrics: [] },
  timeline: {
    buckets: [],
    step: null,
    bounds: null,
    selection: null,
    dragStartIndex: null,
    dragHoverIndex: null,
    targetBuckets: 100,
    playbackTimer: null,
    playbackDelayMs: 1100
  },
  defaultPhysics: {
    nodeRepulsion: 11000,
    idealEdgeLength: 115,
    edgeElasticity: 80,
    gravity: 18,
    nodeOverlap: 12,
    iterations: 2500,
    coolingFactor: 99,
    animate: true,
    live: true
  }
};
