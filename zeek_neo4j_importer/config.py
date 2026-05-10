from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .defaults import DEFAULT_CONFIG


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")

    return values


def env_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "o", "oui"}


def merge_dict(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)

    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_dict(merged[key], value)
        else:
            merged[key] = value

    return merged


def load_config(path: Path) -> dict[str, Any]:
    user_config = json.loads(path.read_text(encoding="utf-8"))
    return normalize_config(merge_dict(DEFAULT_CONFIG, user_config))


def apply_dotenv_to_config(config: dict[str, Any], env_path: Path = Path(".env")) -> dict[str, Any]:
    dotenv = load_dotenv(env_path)
    if not dotenv:
        return config

    neo4j_config = config["neo4j"]

    if dotenv.get("NEO4J_AUTH") and "/" in dotenv["NEO4J_AUTH"]:
        username, password = dotenv["NEO4J_AUTH"].split("/", 1)
        neo4j_config["username"] = username
        neo4j_config["password"] = password

    if dotenv.get("NEO4J_URI"):
        neo4j_config["uri"] = dotenv["NEO4J_URI"]
    elif dotenv.get("NEO4J_BOLT_PORT"):
        neo4j_config["uri"] = f"bolt://localhost:{dotenv['NEO4J_BOLT_PORT']}"

    if dotenv.get("NEO4J_USERNAME"):
        neo4j_config["username"] = dotenv["NEO4J_USERNAME"]
    if dotenv.get("NEO4J_PASSWORD"):
        neo4j_config["password"] = dotenv["NEO4J_PASSWORD"]
    if dotenv.get("NEO4J_DATABASE"):
        neo4j_config["database"] = dotenv["NEO4J_DATABASE"]
    if dotenv.get("NEO4J_CREATE_DATABASE"):
        neo4j_config["create_database"] = env_bool(dotenv["NEO4J_CREATE_DATABASE"])

    return normalize_config(config)


def normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    graph = config.setdefault("graph", {})

    # Compatibility with the previous script naming.
    if "event_property_fields" not in graph and "edge_property_fields" in graph:
        graph["event_property_fields"] = graph["edge_property_fields"]
    if "edge_property_fields" not in graph and "event_property_fields" in graph:
        graph["edge_property_fields"] = graph["event_property_fields"]

    if not graph.get("timestamp_enabled", True):
        graph["timestamp_format"] = "none"

    return config


def write_example_config(path: Path) -> None:
    config = merge_dict(DEFAULT_CONFIG, {})
    config["input"]["paths"] = ["zeek/logs/conn.jsonl"]
    path.write_text(json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
