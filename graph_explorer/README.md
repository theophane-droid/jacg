# JACG

Just a Cyber Graph

Event-node aware graph UI for Neo4j data modeled as:

```cypher
(src)-[:SRC_OF]->(event)-[:DST_TO]->(dst)
```

The app auto-discovers labels and event fields from the data, then lets you filter visually from the GUI.

## Timeline buckets

The timeline step is selected automatically from the global event time range. The target bucket count is configurable:

```bash
GRAPH_TIMELINE_TARGET_BUCKETS=100
```

The value is clamped to at least 30 buckets.

## Run

```bash
npm install
npm run build:css
npm start
```

## Added graph investigation controls

- Event Explorer now supports a custom Neo4j `WHERE` expression through **Neo4j WHERE filter**.
  - Available aliases: `src`, `dst`, `e`.
  - Write literal values directly in the expression.
  - Example with a list: `toIntegerOrNull(e.id_resp_p) IN [80, 443, 8080, 8443]`.
- Node context menu now includes:
  - **Hide node**: hides the selected node from the current Cytoscape view.
  - **Show hidden nodes**: restores hidden graph elements.
  - **Node statistics**: opens a stats popup with inbound/outbound event counts, neighbor counts, top neighbors, top ports/services, and first/last seen.
- Event Explorer controls are organized by workflow: investigate, time window, graph shape, then manual Cypher.
- The top bar includes a Neo4j database selector that lists online databases from the same instance.
