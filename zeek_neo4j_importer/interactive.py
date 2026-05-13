from __future__ import annotations

import getpass
from pathlib import Path
from typing import Any

from .config import merge_dict
from .defaults import DEFAULT_CONFIG
from .identifiers import property_key, relationship_from_fields, role_label_from_fields, sanitize_identifier
from .jsonl import preview_fields, print_preview, sample_records
from .profiles import list_profiles, load_profile, save_profile


def prompt(default: str, message: str, secret: bool = False) -> str:
    suffix = f" [{default}]" if default else ""
    reader = getpass.getpass if secret else input
    value = reader(f"{message}{suffix}: ").strip()
    return value or default


def parse_field_list(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def choose_fields(
    records: list[dict[str, Any]],
    default: list[str],
    message: str,
    max_fields: int = 2,
    min_fields: int = 1,
) -> list[str]:
    fields = [field for field, _, _ in preview_fields(records)]
    default_text = ",".join(default)

    while True:
        value = prompt(default_text, message)
        selected = []

        for item in parse_field_list(value):
            if item.isdigit() and 1 <= int(item) <= len(fields):
                selected.append(fields[int(item) - 1])
            else:
                selected.append(item)

        selected = [field for field in selected if field]

        if min_fields <= len(selected) <= max_fields:
            return selected

        print(f"Choose between {min_fields} and {max_fields} fields.")


def interactive_aggregations() -> list[dict[str, str]]:
    aggregations: list[dict[str, str]] = []

    count_enabled = prompt("y", "Add count aggregation? (y/n)").lower() in {"y", "yes", "o", "oui"}
    if count_enabled:
        aggregations.append({"op": "count", "name": "count"})

    avg_fields = parse_field_list(prompt("", "Fields to average on aggregated edges, comma-separated"))
    for field in avg_fields:
        aggregations.append({"op": "avg", "field": field, "name": f"avg_{property_key(field)}"})

    sum_fields = parse_field_list(prompt("", "Fields to sum on aggregated edges, comma-separated"))
    for field in sum_fields:
        aggregations.append({"op": "sum", "field": field, "name": f"sum_{property_key(field)}"})

    return aggregations


def interactive_config(paths: list[Path], base_config: dict[str, Any] | None = None) -> dict[str, Any]:
    config = merge_dict(base_config or DEFAULT_CONFIG, {})
    config["input"]["paths"] = [str(path) for path in paths]

    records = sample_records(paths, int(config["input"]["sample_size"]))
    print_preview(records)

    graph = config["graph"]

    profiles = list_profiles()
    if profiles:
        print("\nAvailable netgraph profiles:")
        print("  0. No profile")

        for idx, profile_path in enumerate(profiles, start=1):
            print(f"  {idx}. {profile_path.stem}")

        choice = prompt("0", "Load profile number")

        if choice.isdigit() and 1 <= int(choice) <= len(profiles):
            profile_path = profiles[int(choice) - 1]
            config = merge_dict(config, load_profile(profile_path))

            # Preserve the files passed on the command line.
            config["input"]["paths"] = [str(path) for path in paths]

            graph = config["graph"]

            print(f"\nLoaded profile: {profile_path.stem}")
            print(f"Source fields: {', '.join(graph.get('source_fields', []))}")
            print(f"Destination fields: {', '.join(graph.get('destination_fields', []))}")
            print(f"Event label: {graph.get('event_node_label', 'Event')}")
            print(f"Mode: {graph.get('edge_mode', 'event')}")
            print("Using profile as-is. Starting import without more questions.")

            return config
    graph["source_fields"] = choose_fields(
        records,
        graph["source_fields"],
        "Source field(s), comma-separated names or numbers",
        max_fields=2,
    )

    graph["destination_fields"] = choose_fields(
        records,
        graph["destination_fields"],
        "Destination field(s), comma-separated names or numbers",
        max_fields=2,
    )

    graph["source_node_key_fields"] = choose_fields(
        records,
        graph.get("source_node_key_fields") or graph["source_fields"],
        "Source node merge key field(s). Use the field(s) that describe the source entity identity",
        max_fields=2,
    )

    graph["destination_node_key_fields"] = choose_fields(
        records,
        graph.get("destination_node_key_fields") or graph["destination_fields"],
        "Destination node merge key field(s). Use the field(s) that describe the destination entity identity",
        max_fields=2,
    )

    graph["entity_node_label"] = prompt(
        graph.get("entity_node_label") or "Entity",
        "Common Neo4j label used to merge source and destination nodes",
    )

    graph["source_node_label"] = prompt(
        graph.get("source_node_label") or role_label_from_fields("src", graph["source_fields"], "Source"),
        "Additional Neo4j label for source nodes",
    )

    graph["destination_node_label"] = prompt(
        graph.get("destination_node_label") or role_label_from_fields("dst", graph["destination_fields"], "Destination"),
        "Additional Neo4j label for destination nodes",
    )

    graph["event_node_label"] = prompt(
        graph.get("event_node_label", "Event"),
        "Neo4j label for event nodes",
    )

    graph["source_caption_fields"] = parse_field_list(
        prompt(
            ",".join(graph.get("source_caption_fields", [])),
            "Source caption fields, comma-separated. Empty keeps default value",
        )
    )

    graph["destination_caption_fields"] = parse_field_list(
        prompt(
            ",".join(graph.get("destination_caption_fields", [])),
            "Destination caption fields, comma-separated. Empty keeps default value",
        )
    )

    graph["event_caption_fields"] = parse_field_list(
        prompt(
            ",".join(graph.get("event_caption_fields", [])),
            "Event caption fields, comma-separated. Example: ts,proto,service,id.resp_p",
        )
    )

    graph["import_label"] = prompt(graph["import_label"], "Import label used to tag and delete this dataset")

    edge_mode = prompt(graph["edge_mode"], "Graph mode: event or aggregate").lower()
    graph["edge_mode"] = "aggregate" if edge_mode in {"aggregate", "agg"} else "event"

    if graph["edge_mode"] == "event":
        graph["source_event_relationship_type"] = sanitize_identifier(
            prompt(graph.get("source_event_relationship_type", "SRC_OF"), "Source -> Event relationship type"),
            "SRC_OF",
        ).upper()

        graph["event_destination_relationship_type"] = sanitize_identifier(
            prompt(graph.get("event_destination_relationship_type", "DST_TO"), "Event -> Destination relationship type"),
            "DST_TO",
        ).upper()
    else:
        graph["relationship_type"] = sanitize_identifier(
            prompt(
                graph.get("relationship_type") or relationship_from_fields(graph["source_fields"], graph["destination_fields"]),
                "Aggregated relationship type",
            ),
            "OBSERVED",
        ).upper()

    timestamp_enabled = prompt("y" if graph.get("timestamp_enabled", True) else "n", "Parse a timestamp field? (y/n)").lower()
    graph["timestamp_enabled"] = timestamp_enabled in {"y", "yes", "o", "oui", "1", "true"}

    if graph["timestamp_enabled"]:
        graph["timestamp_field"] = prompt(graph.get("timestamp_field", "ts"), "Timestamp field, e.g. ts for Zeek")

        print("\nTimestamp formats:")
        print("  none")
        print("  epoch_float")
        print("  epoch_int")
        print("  iso")
        print("  python")

        graph["timestamp_format"] = prompt(graph.get("timestamp_format", "epoch_float"), "Timestamp format").strip()

        if graph["timestamp_format"] == "python":
            graph["timestamp_python_format"] = prompt(
                graph.get("timestamp_python_format", "%Y-%m-%d %H:%M:%S"),
                "Python datetime format for strptime",
            )

        graph["timestamp_timezone"] = prompt(graph.get("timestamp_timezone", "UTC"), "Timezone for naive timestamps")
    else:
        graph["timestamp_format"] = "none"

    event_fields = prompt(
        ",".join(graph.get("event_property_fields") or graph.get("edge_property_fields", [])),
        "Event property fields, comma-separated. Use '*' for all event properties",
    )

    if event_fields.strip() == "*":
        graph["include_all_event_properties"] = True
    else:
        graph["include_all_event_properties"] = False
        graph["event_property_fields"] = parse_field_list(event_fields)
        graph["edge_property_fields"] = graph["event_property_fields"]

    if graph["edge_mode"] == "aggregate":
        graph["aggregations"] = interactive_aggregations()
    else:
        graph["aggregations"] = []

    graph["include_raw_json"] = prompt(
        "y" if graph.get("include_raw_json") else "n",
        "Include raw JSON as property? (y/n)",
    ).lower() in {"y", "yes", "o", "oui", "1", "true"}

    config["neo4j"]["uri"] = prompt(config["neo4j"]["uri"], "URI Bolt Neo4j")
    config["neo4j"]["username"] = prompt(config["neo4j"]["username"], "Neo4j username")
    config["neo4j"]["password"] = prompt(config["neo4j"]["password"], "Neo4j password", secret=True)
    config["neo4j"]["database"] = prompt(config["neo4j"]["database"], "Target Neo4j database")

    create_db = prompt("n", "Create the database if missing? Enterprise only usually. (y/n)").lower()
    config["neo4j"]["create_database"] = create_db in {"o", "oui", "y", "yes"}

    save_choice = prompt("n", "Save this graph configuration as a netgraph profile? (y/n)").lower()
    if save_choice in {"y", "yes", "o", "oui"}:
        default_name = graph.get("import_label") or graph.get("event_node_label") or "profile"
        profile_name = prompt(default_name, "Profile name")
        saved_path = save_profile(profile_name, config)
        print(f"Profile saved: {saved_path}")

    return config
