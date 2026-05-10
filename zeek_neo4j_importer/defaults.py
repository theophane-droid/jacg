from __future__ import annotations

from typing import Any

DEFAULT_EVENT_PROPERTY_FIELDS = [
    "uid",
    "@stream",
    "ts",
    "proto",
    "service",
    "id.orig_p",
    "id.resp_p",
    "id_orig_p",
    "id_resp_p",
    "conn_state",
    "history",
    "duration",
    "orig_bytes",
    "resp_bytes",
    "orig_pkts",
    "resp_pkts",
    "client",
    "success",
    "forwardable",
    "renewable",
    "cipher",
]

DEFAULT_CONFIG: dict[str, Any] = {
    "neo4j": {
        "uri": "bolt://localhost:7687",
        "username": "neo4j",
        "password": "change-me-strong-password",
        "database": "neo4j",
        "create_database": False,
    },
    "input": {
        "paths": [],
        "sample_size": 50,
        "batch_size": 500,
    },
    "graph": {
        "import_label": "ZeekImport",

        "entity_node_label": "Entity",
        "source_node_label": "",
        "destination_node_label": "",
        "event_node_label": "Event",

        "source_caption_fields": [],
        "destination_caption_fields": [],
        "event_caption_fields": [],

        "source_fields": ["id.orig_h"],
        "destination_fields": ["id.resp_h"],
        "source_node_key_fields": [],
        "destination_node_key_fields": [],

        # aggregate mode only
        "relationship_type": "",

        # event mode
        "source_event_relationship_type": "SRC_OF",
        "event_destination_relationship_type": "DST_TO",

        # event:
        #   (:Source)-[:SRC_OF]->(:Event)-[:DST_TO]->(:Destination)
        # aggregate:
        #   (:Source)-[:REL]->(:Destination)
        "edge_mode": "event",

        "event_property_fields": DEFAULT_EVENT_PROPERTY_FIELDS,
        # backward compatibility with older config name
        "edge_property_fields": DEFAULT_EVENT_PROPERTY_FIELDS,

        "timestamp_enabled": True,
        "timestamp_field": "ts",
        "timestamp_format": "epoch_float",
        "timestamp_python_format": "",
        "timestamp_timezone": "UTC",

        "event_id_fields": ["uid", "_path", "ts"],
        "include_all_event_properties": False,
        "include_raw_json": False,

        # aggregate mode only
        "aggregations": [
            {"op": "count", "name": "count"},
        ],
    },
}
