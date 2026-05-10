from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .identifiers import property_key, relationship_from_fields, role_label_from_fields, sanitize_identifier
from .timeparse import parse_datetime_value


def neo4j_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    if isinstance(value, list):
        converted = []
        for item in value:
            item_value = neo4j_value(item)
            if isinstance(item_value, (str, int, float, bool)):
                converted.append(item_value)
        return converted

    return json.dumps(value, sort_keys=True, default=str)


def numeric_value(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None

    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def build_event_id(record: dict[str, Any], path: Path, line_no: int, fields: list[str]) -> str:
    parts = [str(record.get(field, "")) for field in fields if record.get(field) not in (None, "")]

    if not parts:
        parts = [str(path), str(line_no), json.dumps(record, sort_keys=True, default=str)]

    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()


def composite_value(record: dict[str, Any], fields: list[str]) -> str | None:
    values = []

    for field in fields:
        value = record.get(field)

        if value in (None, "", []):
            return None

        values.append(str(value))

    return "|".join(values)


def display_value(fields: list[str], value: str) -> str:
    if len(fields) == 1:
        return value
    return f"{'+'.join(fields)}: {value}"


def caption_from_values(fields: list[str], values: dict[str, Any], fallback: str) -> str:
    parts = []

    for field in fields:
        key = property_key(field)
        value = values.get(field, values.get(key))

        if value not in (None, "", []):
            parts.append(f"{field}={value}")

    return " | ".join(parts) if parts else fallback


def base_event_properties(
    record: dict[str, Any],
    config: dict[str, Any],
    path: Path,
    line_no: int,
    event_id: str,
) -> dict[str, Any]:
    graph = config["graph"]
    timestamp_field = graph.get("timestamp_field", "ts")
    ts_raw = record.get(timestamp_field)
    ts_iso = parse_datetime_value(ts_raw, graph)

    props = {
        "event_id": event_id,
        "source_file": str(path),
        "source_line": line_no,
        "log_type": path.name,
        "ts_iso": ts_iso,
    }

    if graph.get("timestamp_enabled", True):
        props["timestamp_field"] = timestamp_field
        if ts_raw is not None:
            props["ts_raw"] = neo4j_value(ts_raw)

    if graph.get("include_all_event_properties"):
        selected_fields = sorted(record.keys())
    else:
        selected_fields = graph.get("event_property_fields") or graph.get("edge_property_fields", [])

    for field in selected_fields:
        if field in record:
            props[property_key(field)] = neo4j_value(record[field])

    if graph.get("include_raw_json"):
        props["raw_json"] = json.dumps(record, sort_keys=True, default=str)

    return {key: value for key, value in props.items() if value is not None}


def aggregation_values(record: dict[str, Any], aggregations: list[dict[str, str]]) -> dict[str, Any]:
    values: dict[str, Any] = {}

    for agg in aggregations:
        op = agg.get("op")
        name = property_key(agg.get("name") or f"{op}_{agg.get('field', '')}")
        field = agg.get("field")

        if op == "count":
            values[name] = 1
        elif op in {"sum", "avg"} and field:
            values[name] = numeric_value(record.get(field))

    return values


def build_row(record: dict[str, Any], config: dict[str, Any], path: Path, line_no: int) -> dict[str, Any] | None:
    graph = config["graph"]
    source_key_fields = graph.get("source_node_key_fields") or graph.get("source_merge_fields") or graph["source_fields"]
    destination_key_fields = graph.get("destination_node_key_fields") or graph.get("destination_merge_fields") or graph["destination_fields"]

    src_value = composite_value(record, source_key_fields)
    dst_value = composite_value(record, destination_key_fields)

    if not src_value or not dst_value:
        return None

    event_id = build_event_id(record, path, line_no, graph.get("event_id_fields", ["uid", "_path", "ts"]))
    event_props = base_event_properties(record, config, path, line_no, event_id)
    agg_values = aggregation_values(record, graph.get("aggregations", []))

    source_caption = caption_from_values(
        graph.get("source_caption_fields", []),
        record,
        display_value(source_key_fields, src_value),
    )

    destination_caption = caption_from_values(
        graph.get("destination_caption_fields", []),
        record,
        display_value(destination_key_fields, dst_value),
    )

    event_caption = caption_from_values(
        graph.get("event_caption_fields", []),
        {**record, **event_props, **agg_values},
        event_props.get("ts_iso") or event_id,
    )

    edge_caption = caption_from_values(
        graph.get("edge_caption_fields", []),
        {**event_props, **agg_values},
        "",
    )

    edge_key_parts = [
        "|".join(source_key_fields),
        src_value,
        "|".join(destination_key_fields),
        dst_value,
        graph.get("relationship_type") or relationship_from_fields(graph["source_fields"], graph["destination_fields"]),
    ]

    edge_key = hashlib.sha256("\n".join(edge_key_parts).encode("utf-8")).hexdigest()

    return {
        "event_id": event_id,
        "edge_key": edge_key,
        "src_value": src_value,
        "dst_value": dst_value,
        "src_display": source_caption,
        "dst_display": destination_caption,
        "event_display": event_caption,
        "src_fields": graph["source_fields"],
        "dst_fields": graph["destination_fields"],
        "src_key_fields": source_key_fields,
        "dst_key_fields": destination_key_fields,
        "event_props": event_props,
        "edge_props": event_props,
        "edge_caption": edge_caption,
        "edge_caption_fields": [property_key(field) for field in graph.get("edge_caption_fields", [])],
        "agg_values": agg_values,
        "ts_iso": event_props.get("ts_iso"),
        "import_label": graph["import_label"],
    }


def labels_from_config(config: dict[str, Any]) -> dict[str, str]:
    graph = config["graph"]

    return {
        "entity": sanitize_identifier(
            graph.get("entity_node_label") or "Entity",
            "Entity",
        ),
        "source": sanitize_identifier(
            graph.get("source_node_label") or role_label_from_fields("src", graph["source_fields"], "Source"),
            "Source",
        ),
        "destination": sanitize_identifier(
            graph.get("destination_node_label") or role_label_from_fields("dst", graph["destination_fields"], "Destination"),
            "Destination",
        ),
        "event": sanitize_identifier(
            graph.get("event_node_label") or "Event",
            "Event",
        ),
        "relationship": sanitize_identifier(
            graph.get("relationship_type") or relationship_from_fields(graph["source_fields"], graph["destination_fields"]),
            "OBSERVED",
        ).upper(),
        "source_event_relationship": sanitize_identifier(
            graph.get("source_event_relationship_type") or "SRC_OF",
            "SRC_OF",
        ).upper(),
        "event_destination_relationship": sanitize_identifier(
            graph.get("event_destination_relationship_type") or "DST_TO",
            "DST_TO",
        ).upper(),
    }
