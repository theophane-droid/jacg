from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import merge_dict
from .identifiers import sanitize_identifier

PROFILE_DIR = Path("netgraph_profiles")


def list_profiles(profile_dir: Path = PROFILE_DIR) -> list[Path]:
    if not profile_dir.exists():
        return []
    return sorted(profile_dir.glob("*.json"))


def load_profile(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    profile_name = data.get("name") or path.stem

    if "graph" in data:
        graph = data["graph"]
    else:
        graph = data

    graph = migrate_graph_profile(graph)
    graph["profile_name"] = profile_name

    return {"graph": graph}


def save_profile(name: str, config: dict[str, Any], profile_dir: Path = PROFILE_DIR) -> Path:
    profile_dir.mkdir(parents=True, exist_ok=True)

    filename = sanitize_identifier(name, "profile").lower()
    path = profile_dir / f"{filename}.json"

    data = {
        "name": name,
        "graph": migrate_graph_profile(config["graph"]),
    }

    path.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    return path


def migrate_profile_file(path: Path) -> bool:
    """
    Migrate an existing profile JSON file in place.

    Returns True if the file changed.
    """
    original = path.read_text(encoding="utf-8")
    data = json.loads(original)

    if "graph" in data:
        data["graph"] = migrate_graph_profile(data["graph"])
    else:
        data = {
            "name": path.stem,
            "graph": migrate_graph_profile(data),
        }

    migrated = json.dumps(data, indent=2, ensure_ascii=False) + "\n"

    if migrated != original:
        path.write_text(migrated, encoding="utf-8")
        return True

    return False


def migrate_all_profiles(profile_dir: Path = PROFILE_DIR) -> list[Path]:
    changed: list[Path] = []

    for path in list_profiles(profile_dir):
        if migrate_profile_file(path):
            changed.append(path)

    return changed


def migrate_graph_profile(graph: dict[str, Any]) -> dict[str, Any]:
    """
    Convert old direct-edge profiles to the new event-node model.

    Old model:
      (:Source)-[:REL]->(:Destination)

    New model:
      (:Source)-[:SRC_OF]->(:Event)-[:DST_TO]->(:Destination)
    """
    migrated = dict(graph)

    source_fields = migrated.get("source_fields", ["id.orig_h"])
    destination_fields = migrated.get("destination_fields", ["id.resp_h"])
    old_relationship = migrated.get("relationship_type") or ""

    migrated.setdefault("source_fields", source_fields)
    migrated.setdefault("destination_fields", destination_fields)

    migrated["edge_mode"] = "event"

    migrated.setdefault("event_node_label", infer_event_label(migrated))
    migrated.setdefault("source_event_relationship_type", "SRC_OF")
    migrated.setdefault("event_destination_relationship_type", "DST_TO")

    # Keep the former direct relationship name only as metadata compatibility.
    migrated["relationship_type"] = old_relationship

    # Rename previous edge fields to event fields.
    if "event_property_fields" not in migrated:
        migrated["event_property_fields"] = migrated.get("edge_property_fields", [])

    if "edge_property_fields" not in migrated:
        migrated["edge_property_fields"] = migrated.get("event_property_fields", [])

    migrated.setdefault("event_caption_fields", infer_event_caption_fields(migrated))

    migrated.setdefault("timestamp_enabled", True)
    migrated.setdefault("timestamp_field", "ts")
    migrated.setdefault("timestamp_format", "epoch_float")
    migrated.setdefault("timestamp_python_format", "")
    migrated.setdefault("timestamp_timezone", "UTC")

    migrated.setdefault("event_id_fields", ["uid", "_path", "ts"])
    migrated.setdefault("include_all_event_properties", False)
    migrated.setdefault("include_raw_json", False)

    # Aggregations are only used in aggregate mode now.
    migrated["aggregations"] = []

    return migrated


def infer_event_label(graph: dict[str, Any]) -> str:
    import_label = str(graph.get("import_label", "")).lower()
    rel = str(graph.get("relationship_type", "")).lower()
    source_fields = ",".join(graph.get("source_fields", [])).lower()
    destination_fields = ",".join(graph.get("destination_fields", [])).lower()
    blob = " ".join([import_label, rel, source_fields, destination_fields])

    if "dns" in blob or "query" in blob or "domain" in blob:
        return "DnsEvent"
    if "http" in blob or "uri" in blob or "host" in blob:
        return "HttpEvent"
    if "ssl" in blob or "tls" in blob or "sni" in blob or "server_name" in blob:
        return "SslEvent"
    if "file" in blob or "sha" in blob or "md5" in blob:
        return "FileEvent"
    if "notice" in blob or "alert" in blob:
        return "NoticeEvent"
    if "conn" in blob or "orig" in blob or "resp" in blob:
        return "ConnEvent"

    return "Event"


def infer_event_caption_fields(graph: dict[str, Any]) -> list[str]:
    fields = graph.get("event_property_fields") or graph.get("edge_property_fields") or []
    preferred = ["ts", "proto", "service", "id.resp_p", "id_resp_p", "query", "host", "uri", "uid"]

    selected = [field for field in preferred if field in fields]

    if selected:
        return selected[:4]

    return ["ts", "uid"]
