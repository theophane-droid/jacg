import { state } from "./state.js";
import { el, log } from "./dom.js";
import { api } from "./api.js";
import { renderGraph } from "./query.js";
import { applyCaptions, applyStyle } from "./style.js";
import { updateSelection } from "./interactions.js";

function val(id) {
  return el(id)?.value?.trim?.() || "";
}

function setVal(id, value) {
  const node = el(id);
  if (node) node.value = value;
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

function option(label, value, suffix = "") {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = suffix ? `${label} (${suffix})` : label;
  return item;
}

function fillSelect(
  select,
  items,
  {
    anyLabel = "auto / any",
    valueKey = "label",
    labelKey = "label",
    current = "__any"
  } = {}
) {
  if (!select) return;

  select.innerHTML = "";
  select.appendChild(option(anyLabel, "__any"));

  for (const item of items || []) {
    const value = typeof item === "string" ? item : item[valueKey];
    const label = typeof item === "string" ? item : item[labelKey];

    if (!value) continue;

    select.appendChild(option(label, value, item.count ?? ""));
  }

  select.value = [...select.options].some((o) => o.value === current)
    ? current
    : "__any";
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = new Date(String(value));
  if (Number.isNaN(date.valueOf())) return "";

  return date.toISOString().slice(0, 19);
}

function toIsoParam(value) {
  if (!value) return "";

  const normalized = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${normalized}Z`);

  return Number.isNaN(date.valueOf()) ? normalized : date.toISOString();
}

function bucketStart(bucket) {
  const date = new Date(String(bucket?.bucket || bucket || ""));
  return Number.isNaN(date.valueOf()) ? null : date;
}

function bucketEnd(bucket, stepMs) {
  const start = bucketStart(bucket);
  return start ? new Date(start.getTime() + Number(stepMs || 3600000)) : null;
}

function isBucketSelected(bucket, selection, stepMs) {
  if (!selection?.from || !selection?.to) return false;

  const start = bucketStart(bucket);
  const end = bucketEnd(bucket, stepMs);
  const from = new Date(selection.from);
  const to = new Date(selection.to);

  if (
    !start ||
    !end ||
    Number.isNaN(from.valueOf()) ||
    Number.isNaN(to.valueOf())
  ) {
    return false;
  }

  return end > from && start < to;
}

function setTimeInputsFromSelection(selection) {
  if (!selection?.from || !selection?.to) return;

  el("timeFrom").value = toDateTimeLocal(selection.from);
  el("timeTo").value = toDateTimeLocal(selection.to);
}

function selectedTimelineIndexes() {
  const buckets = state.timeline.buckets || [];
  if (!buckets.length) return null;
  const stepMs = Number(state.timeline.step?.ms || 3600000);
  const selected = buckets
    .map((bucket, index) =>
      isBucketSelected(bucket, state.timeline.selection, stepMs) ? index : null
    )
    .filter((index) => index !== null);

  if (!selected.length) return null;

  return {
    start: Math.min(...selected),
    end: Math.max(...selected)
  };
}

function setTimelineSelectionFromIndexes(startIndex, endIndex, { reload = true } = {}) {
  const buckets = state.timeline.buckets || [];
  if (!buckets.length) return;

  const a = clamp(Math.min(startIndex, endIndex), 0, buckets.length - 1);
  const b = clamp(Math.max(startIndex, endIndex), 0, buckets.length - 1);
  const start = bucketStart(buckets[a]);
  const end = bucketEnd(buckets[b], state.timeline.step?.ms);

  if (!start || !end) return;

  // Snap the released selection to exact bucket boundaries: first bar start,
  // last bar end. This keeps the datetime inputs aligned with what is visible.
  state.timeline.selection = {
    from: start.toISOString(),
    to: end.toISOString()
  };

  setTimeInputsFromSelection(state.timeline.selection);
  renderTimeline(buckets);

  if (reload) loadAggregate();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function timelineIndexFromEvent(event, wrap) {
  const buckets = state.timeline.buckets || [];
  if (!buckets.length) return null;

  const rect = wrap.getBoundingClientRect();
  if (!rect.width) return null;

  const x = clamp(event.clientX - rect.left, 0, rect.width);
  const index = Math.floor((x / rect.width) * buckets.length);

  return clamp(index, 0, buckets.length - 1);
}

function formatTimelineDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) return "";

  return date.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}


function eventFilterExtras() {
  if (state.neighborhood.active) {
    return { eventWhere: "" };
  }

  return {
    eventWhere: val("eventCypherFilter")
  };
}

function filterSnapshot() {
  return {
    filterField: val("filterField"),
    filterValue: val("filterValue"),
    eventSearch: val("eventSearch"),
    eventCypherFilter: val("eventCypherFilter")
  };
}

function restoreFilterSnapshot(snapshot) {
  if (!snapshot) return;
  setVal("filterField", snapshot.filterField || "");
  setVal("filterValue", snapshot.filterValue || "");
  setVal("eventSearch", snapshot.eventSearch || "");
  setVal("eventCypherFilter", snapshot.eventCypherFilter || "");
}

function cypherStringLiteral(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function pivotWhere(value) {
  const literal = cypherStringLiteral(value);
  return `toString(src.value) = ${literal} OR toString(dst.value) = ${literal} OR toString(src.name) = ${literal} OR toString(dst.name) = ${literal} OR elementId(src) = ${literal} OR elementId(dst) = ${literal}`;
}

function setNeighborhoodBar(active, text = "") {
  const bar = el("neighborhoodBar");
  const label = el("neighborhoodText");
  if (!bar || !label) return;
  label.textContent = text || "Neighborhood view";
  bar.classList.toggle("hidden", !active);
}

function markPivotNode(data) {
  const pivotValue = String(data.value || data.caption || data.name || data.id || "");
  const pivotId = String(data.id || "");

  state.cy.nodes().removeClass("pivot");
  state.cy.nodes().filter((node) => {
    const nodeData = node.data();
    return (
      node.id() === pivotId ||
      String(nodeData.id || "") === pivotId ||
      String(nodeData.value || "") === pivotValue ||
      String(nodeData.caption || "") === pivotValue ||
      String(nodeData.label || "") === pivotValue
    );
  }).addClass("pivot");
}

function enterNeighborhoodState(data, direction) {
  if (!state.neighborhood.active) {
    state.neighborhood.previousFilters = filterSnapshot();
  }

  const pivot = data.value || data.caption || data.name || data.id;
  state.neighborhood.active = true;
  state.neighborhood.pivot = { value: pivot, direction };

  setVal("filterField", "");
  setVal("filterValue", "");
  setVal("eventSearch", "");
  setVal("eventCypherFilter", `/* pivot filter applied by API */ ${pivotWhere(pivot)}`);

  setNeighborhoodBar(true, `Neighborhood pivot: ${pivot}`);
}

export function exitNeighborhoodState() {
  if (!state.neighborhood.active) return false;

  restoreFilterSnapshot(state.neighborhood.previousFilters);
  state.neighborhood.active = false;
  state.neighborhood.pivot = null;
  state.neighborhood.previousFilters = null;
  setNeighborhoodBar(false);
  return true;
}

function params() {
  const pivotExtra = state.neighborhood.active && state.neighborhood.pivot?.value
    ? { pivotValue: state.neighborhood.pivot.value }
    : {};

  return new URLSearchParams({
    from: toIsoParam(val("timeFrom")),
    to: toIsoParam(val("timeTo")),
    limit: val("aggregateLimit") || "500",
    entityLabel: val("entityLabel") || state.graphConfig.entityLabel || "__any",
    eventLabel: val("eventLabel") || state.graphConfig.eventLabel || "__any",
    groupBy: val("aggregateMode") || "pair",
    widthBy: val("widthMetric") || "event_count",
    filterField: val("filterField"),
    filterValue: val("filterValue"),
    eventSearch: val("eventSearch"),
    ...eventFilterExtras(),
    ...pivotExtra
  });
}

export function currentTimeParams(extra = {}) {
  const pivotExtra = state.neighborhood.active && state.neighborhood.pivot?.value
    ? { pivotValue: state.neighborhood.pivot.value }
    : {};

  return new URLSearchParams({
    from: toIsoParam(val("timeFrom")),
    to: toIsoParam(val("timeTo")),
    limit: val("detailLimit") || "200",
    entityLabel: val("entityLabel") || state.graphConfig.entityLabel || "__any",
    eventLabel: val("eventLabel") || state.graphConfig.eventLabel || "__any",
    filterField: val("filterField"),
    filterValue: val("filterValue"),
    eventSearch: val("eventSearch"),
    ...eventFilterExtras(),
    ...pivotExtra,
    ...extra
  });
}

export async function loadGraphConfig() {
  const config = await api("/api/graph/config");
  state.graphConfig = config;

  fillSelect(el("entityLabel"), config.entityLabels || [], {
    current: config.entityLabel || "__any"
  });

  fillSelect(el("eventLabel"), config.eventLabels || [], {
    current: config.eventLabel || "__any"
  });

  const aggregateMode = el("aggregateMode");
  if (aggregateMode) {
    aggregateMode.innerHTML = "";

    for (const mode of config.aggregateModes || []) {
      aggregateMode.appendChild(option(mode.label, mode.id));
    }
  }

  const widthMetric = el("widthMetric");
  if (widthMetric) {
    widthMetric.innerHTML = "";

    for (const metric of config.widthMetrics || []) {
      widthMetric.appendChild(option(metric.label, metric.id));
    }
  }

  const filterField = el("filterField");
  if (filterField) {
    filterField.innerHTML = "";
    filterField.appendChild(option("none", ""));

    for (const field of config.eventFields || []) {
      filterField.appendChild(option(field, field));
    }
  }

  if (!val("timeFrom") && config.timeBounds?.from) {
    el("timeFrom").value = toDateTimeLocal(config.timeBounds.from);
  }

  if (!val("timeTo") && config.timeBounds?.to) {
    el("timeTo").value = toDateTimeLocal(config.timeBounds.to);
  }

  if (config.discoveryError) {
    log(`Discovery warning: ${config.discoveryError}`, "error");
  } else {
    log("Graph shape discovered from SRC_OF/DST_TO paths", "ok");
  }
}

export async function loadAggregate() {
  try {
    const data = await api(`/api/graph/aggregate?${params()}`);

    renderGraph(data.graph);

    setText("nodeCount", data.summary.nodes);
    setText("edgeCount", data.summary.edges);
    setText("rowCount", data.summary.rows);

    log(`Aggregate loaded: ${data.summary.edges} virtual communications`, "ok");

    await loadTimeline();
  } catch (e) {
    log(e.message, "error");
  }
}

export async function loadPairEvents(edge) {
  const data = edge.data();

  if (!data.source_value || !data.destination_value) return;

  try {
    const query = currentTimeParams({
      source: data.source_value,
      target: data.destination_value,
      sourceLabel: data.source_label || "",
      targetLabel: data.target_label || ""
    });

    const result = await api(`/api/graph/pair/events?${query}`);

    renderGraph(result.graph);

    setText("nodeCount", result.summary.nodes);
    setText("edgeCount", result.summary.edges);
    setText("rowCount", result.summary.rows);

    log(
      `Detailed events loaded for ${data.source_value} → ${data.destination_value}`,
      "ok"
    );

    await loadTimeline(data.source_value, data.destination_value);
  } catch (e) {
    log(e.message, "error");
  }
}

export async function expandNode(node, direction = "both", { append = false } = {}) {
  const data = node.data();
  const nodeId = encodeURIComponent(data.id);

  try {
    enterNeighborhoodState(data, direction);
    const query = currentTimeParams({ direction, entityLabel: "__any", eventLabel: "__any" });
    const result = await api(`/api/graph/node/${nodeId}/neighbors?${query}`);

    renderGraph(result.graph, { append });
    markPivotNode(data);

    setText("nodeCount", result.summary.nodes);
    setText("edgeCount", result.summary.edges);
    setText("rowCount", result.summary.rows);

    if (append) {
      setText("nodeCount", state.cy.nodes().length);
      setText("edgeCount", state.cy.edges().length);
    }

    log(`Expanded ${direction} real neighbors for ${data.caption || data.id}${append ? " without clearing the graph" : ""}; previous filters are suspended, time range kept.`, "ok");
  } catch (e) {
    log(e.message, "error");
  }
}

export async function loadEventDetails(node) {
  const eventId = node.data("event_id") || String(node.id()).replace(/^EVENT:/, "");

  try {
    const query = currentTimeParams();
    const result = await api(`/api/graph/event/${encodeURIComponent(eventId)}?${query}`);

    el("inspector").textContent = JSON.stringify(
      result.e?.properties || result,
      null,
      2
    );

    updateSelection(node);

    log(`Event details loaded: ${eventId}`, "ok");
  } catch (e) {
    log(e.message, "error");
  }
}

export async function runSearch() {
  const q = val("entitySearch");
  if (!q) return;

  try {
    const query = currentTimeParams({ q, limit: "20" });
    const data = await api(`/api/graph/search?${query}`);
    const box = el("searchResults");

    box.innerHTML = "";

    for (const item of data.results || []) {
      const button = document.createElement("button");

      button.type = "button";
      button.className = "search-result";
      button.textContent = item.caption || item.display || item.name || item.value;

      button.addEventListener("click", async () => {
        const label = item.labels?.[0] || val("entityLabel") || "Entity";

        await expandNode(
          {
            data: () => ({
              id: `${label}:${item.value}`,
              caption: item.value
            })
          },
          "both"
        );
      });

      box.appendChild(button);
    }

    if (!box.children.length) {
      box.textContent = "No result";
    }
  } catch (e) {
    log(e.message, "error");
  }
}

export async function loadTimeline(source = "", target = "") {
  try {
    const query = new URLSearchParams({
      source,
      target,
      entityLabel: val("entityLabel") || state.graphConfig.entityLabel || "__any",
      eventLabel: val("eventLabel") || state.graphConfig.eventLabel || "__any",
      filterField: val("filterField"),
      filterValue: val("filterValue"),
      eventSearch: val("eventSearch"),
      ...eventFilterExtras(),
      buckets: String(state.timeline?.targetBuckets || 100)
    });

    const data = await api(`/api/graph/timeline?${query}`);

    state.timeline.buckets = data.buckets || [];
    state.timeline.step = data.step || { ms: 3600000, label: "1h" };
    state.timeline.bounds = data.bounds || null;

    state.timeline.selection =
      val("timeFrom") && val("timeTo")
        ? {
            from: toIsoParam(val("timeFrom")),
            to: toIsoParam(val("timeTo"))
          }
        : data.selection || null;

    renderTimeline(state.timeline.buckets);
  } catch (e) {
    log(e.message, "error");
  }
}

function selectTimelineRange(startIndex, endIndex) {
  const buckets = state.timeline.buckets || [];
  if (!buckets.length) return;

  state.timeline.dragStartIndex = null;
  state.timeline.dragHoverIndex = null;

  setTimelineSelectionFromIndexes(startIndex, endIndex);
}

function moveTimelineSelection(delta) {
  const buckets = state.timeline.buckets || [];
  if (!buckets.length) return;

  const current = selectedTimelineIndexes() || { start: 0, end: 0 };
  const width = current.end - current.start;
  const nextStart = clamp(current.start + delta, 0, Math.max(0, buckets.length - width - 1));
  const nextEnd = clamp(nextStart + width, 0, buckets.length - 1);

  setTimelineSelectionFromIndexes(nextStart, nextEnd);
}

function stopTimelinePlayback() {
  if (state.timeline.playbackTimer) {
    window.clearInterval(state.timeline.playbackTimer);
    state.timeline.playbackTimer = null;
  }
  const button = el("timelinePlayButton");
  if (button) button.textContent = "Play";
}

function toggleTimelinePlayback() {
  if (state.timeline.playbackTimer) {
    stopTimelinePlayback();
    return;
  }

  moveTimelineSelection(1);
  state.timeline.playbackTimer = window.setInterval(() => {
    const current = selectedTimelineIndexes();
    if (current && current.end >= (state.timeline.buckets || []).length - 1) {
      stopTimelinePlayback();
      return;
    }
    moveTimelineSelection(1);
  }, state.timeline.playbackDelayMs);

  const button = el("timelinePlayButton");
  if (button) button.textContent = "Pause";
}

function renderTimeline(buckets) {
  const wrap = el("timebar");
  if (!wrap) return;

  wrap.innerHTML = "";
  wrap.classList.add("timebar-interactive");

  const max = buckets.reduce((m, b) => Math.max(m, Number(b.count || 0)), 1);
  const stepMs = Number(state.timeline.step?.ms || 3600000);

  const dragStart = state.timeline.dragStartIndex;
  const dragHover = state.timeline.dragHoverIndex;

  const dragMin =
    dragStart == null || dragHover == null
      ? null
      : Math.min(dragStart, dragHover);

  const dragMax =
    dragStart == null || dragHover == null
      ? null
      : Math.max(dragStart, dragHover);

  const hasSelection = state.timeline.selection?.from && state.timeline.selection?.to;

  if (buckets.length) {
    const axis = document.createElement("div");
    axis.className = "timebar-axis";
    const first = bucketStart(buckets[0]);
    const middle = bucketStart(buckets[Math.floor((buckets.length - 1) / 2)]);
    const last = bucketEnd(buckets[buckets.length - 1], stepMs);
    for (const [label, position] of [
      [first, 0],
      [middle, 50],
      [last, 100]
    ]) {
      if (!label) continue;
      const marker = document.createElement("span");
      marker.style.left = `${position}%`;
      marker.textContent = formatTimelineDate(label);
      axis.appendChild(marker);
    }
    wrap.appendChild(axis);
  }

  if (hasSelection && buckets.length) {
    const selectedIndexes = buckets
      .map((bucket, index) =>
        isBucketSelected(bucket, state.timeline.selection, stepMs) ? index : null
      )
      .filter((index) => index !== null);

    if (selectedIndexes.length) {
      const first = Math.min(...selectedIndexes);
      const last = Math.max(...selectedIndexes);

      const overlay = document.createElement("div");
      overlay.className = "timebar-selection-overlay";
      overlay.style.left = `${(first / buckets.length) * 100}%`;
      overlay.style.width = `${((last - first + 1) / buckets.length) * 100}%`;

      const label = document.createElement("div");
      label.className = "timebar-selection-label";
      label.textContent = `${formatTimelineDate(
        state.timeline.selection.from
      )} → ${formatTimelineDate(state.timeline.selection.to)}`;

      overlay.appendChild(label);
      wrap.appendChild(overlay);
    }
  }

  if (dragMin !== null && dragMax !== null && buckets.length) {
    const preview = document.createElement("div");
    preview.className = "timebar-drag-overlay";
    preview.style.left = `${(dragMin / buckets.length) * 100}%`;
    preview.style.width = `${((dragMax - dragMin + 1) / buckets.length) * 100}%`;

    const start = bucketStart(buckets[dragMin]);
    const end = bucketEnd(buckets[dragMax], stepMs);

    if (start && end) {
      const label = document.createElement("div");
      label.className = "timebar-selection-label";
      label.textContent = `${formatTimelineDate(start)} → ${formatTimelineDate(end)}`;
      preview.appendChild(label);
    }

    wrap.appendChild(preview);
  }

  for (const [index, bucket] of buckets.entries()) {
    const bar = document.createElement("button");

    bar.type = "button";
    bar.className = "timebar-bucket";
    bar.dataset.index = String(index);

    const count = Number(bucket.count || 0);

    if (count <= 0) {
      bar.classList.add("empty");
      bar.style.height = "0px";
      bar.title = `${bucket.bucket}: 0 event`;
    } else {
      const height = Math.max(
        4,
        Math.round((count / max) * 48)
      );

      bar.style.height = `${height}px`;
      bar.title = `${bucket.bucket}: ${count} events`;
    }

    if (isBucketSelected(bucket, state.timeline.selection, stepMs)) {
      bar.classList.add("selected");
    }

    if (dragMin !== null && index >= dragMin && index <= dragMax) {
      bar.classList.add("selecting");
    }

    wrap.appendChild(bar);
  }

  wrap.onpointerdown = (event) => {
    event.preventDefault();

    const index = timelineIndexFromEvent(event, wrap);
    if (index === null) return;

    wrap.setPointerCapture?.(event.pointerId);

    state.timeline.dragStartIndex = index;
    state.timeline.dragHoverIndex = index;
    stopTimelinePlayback();

    renderTimeline(buckets);
  };

  wrap.onpointermove = (event) => {
    if (state.timeline.dragStartIndex == null) return;

    const index = timelineIndexFromEvent(event, wrap);
    if (index === null) return;

    if (state.timeline.dragHoverIndex !== index) {
      state.timeline.dragHoverIndex = index;
      renderTimeline(buckets);
    }
  };

  wrap.onpointerup = (event) => {
    if (state.timeline.dragStartIndex == null) return;

    event.preventDefault();

    const index =
      timelineIndexFromEvent(event, wrap) ?? state.timeline.dragHoverIndex;

    selectTimelineRange(state.timeline.dragStartIndex, index);
  };

  wrap.onpointercancel = () => {
    state.timeline.dragStartIndex = null;
    state.timeline.dragHoverIndex = null;

    renderTimeline(buckets);
  };

  const selected =
    state.timeline.selection?.from && state.timeline.selection?.to
      ? ` · selected ${new Date(state.timeline.selection.from)
          .toISOString()
          .slice(0, 19)} → ${new Date(state.timeline.selection.to)
          .toISOString()
          .slice(0, 19)}`
      : "";

  setText(
    "timebarStatus",
    buckets.length
      ? `${buckets.length} buckets · step ${
          state.timeline.step?.label || "auto"
        }${selected}`
      : "No timeline data"
  );
}

export function bindEventGraphControls() {
  el("aggregateLoadButton")?.addEventListener("click", loadAggregate);
  el("timelineLoadButton")?.addEventListener("click", () => loadTimeline());
  el("entitySearchButton")?.addEventListener("click", runSearch);
  el("timelineStepBackButton")?.addEventListener("click", () => {
    stopTimelinePlayback();
    moveTimelineSelection(-1);
  });
  el("timelineStepForwardButton")?.addEventListener("click", () => {
    stopTimelinePlayback();
    moveTimelineSelection(1);
  });
  el("timelinePlayButton")?.addEventListener("click", toggleTimelinePlayback);

  el("eventFilterPreset")?.addEventListener("change", (e) => {
    const value = e.target.value;
    if (!value) return;
    const input = el("eventCypherFilter");
    if (!input) return;
    input.value = value;
    input.focus();
  });

  el("entitySearch")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  for (const id of [
    "entityLabel",
    "eventLabel",
    "aggregateMode",
    "widthMetric",
    "filterField",
    "timeFrom",
    "timeTo",
    "aggregateLimit"
  ]) {
    el(id)?.addEventListener("change", () => {
      if (state.cy?.elements()?.length) loadAggregate();
    });
  }

  for (const id of ["filterValue", "eventSearch", "eventCypherFilter"]) {
    el(id)?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadAggregate();
    });
  }
}

export function fitSelectedTimeFromTimeline() {
  applyCaptions();
  applyStyle();
}
