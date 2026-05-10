from __future__ import annotations

import sys
from typing import Any

from .cypher import aggregation_cypher, relationship_caption_cypher
from .identifiers import cypher_ident
from .jsonl import iter_jsonl, print_preview, sample_records
from .model import build_row, labels_from_config

try:
    from neo4j import GraphDatabase
except ImportError:  # pragma: no cover - handled at runtime.
    GraphDatabase = None


def get_driver(config: dict[str, Any]) -> Any:
    if GraphDatabase is None:
        raise RuntimeError("Missing Python module: install the driver with `pip install neo4j`.")

    return GraphDatabase.driver(
        config["neo4j"]["uri"],
        auth=(config["neo4j"]["username"], config["neo4j"]["password"]),
    )


def ensure_database(driver: Any, database: str) -> None:
    if database in {"", "neo4j", "system"}:
        return

    with driver.session(database="system") as session:
        existing = session.run("SHOW DATABASES YIELD name RETURN collect(name) AS names").single()["names"]

        if database not in existing:
            session.run(f"CREATE DATABASE `{cypher_ident(database)}` IF NOT EXISTS").consume()


def create_constraints(session: Any, labels: dict[str, str]) -> None:
    entity_label = cypher_ident(labels["entity"])
    event_label = cypher_ident(labels["event"])

    entity_idx = cypher_ident(f"{labels['entity'].lower()}_import_value_unique")
    event_idx = cypher_ident(f"{labels['event'].lower()}_event_id_unique")
    event_ts_idx = cypher_ident(f"{labels['event'].lower()}_ts_datetime")

    statements = [
        f"""
        CREATE CONSTRAINT `{entity_idx}` IF NOT EXISTS
        FOR (n:`{entity_label}`)
        REQUIRE (n.import_label, n.value) IS UNIQUE
        """,
        f"""
        CREATE CONSTRAINT `{event_idx}` IF NOT EXISTS
        FOR (e:`{event_label}`)
        REQUIRE (e.import_label, e.event_id) IS UNIQUE
        """,
        f"""
        CREATE RANGE INDEX `{event_ts_idx}` IF NOT EXISTS
        FOR (e:`{event_label}`)
        ON (e.ts_datetime)
        """,
    ]

    for statement in statements:
        session.run(statement).consume()


def write_batch(tx: Any, rows: list[dict[str, Any]], labels: dict[str, str], config: dict[str, Any]) -> None:
    entity_label = cypher_ident(labels["entity"])
    source_label = cypher_ident(labels["source"])
    destination_label = cypher_ident(labels["destination"])
    event_label = cypher_ident(labels["event"])

    if config["graph"]["edge_mode"] == "event":
        src_event_rel = cypher_ident(labels["source_event_relationship"])
        event_dst_rel = cypher_ident(labels["event_destination_relationship"])

        tx.run(
            f"""
            UNWIND $rows AS row

            MERGE (s:`{entity_label}` {{import_label: row.import_label, value: row.src_value}})
            SET s:`{source_label}`
            SET s.source_fields = row.src_fields,
                s.source_key_fields = row.src_key_fields,
                s.is_source = true,
                s.name = row.src_value,
                s.source_display = row.src_display,
                s.display = coalesce(s.display, row.src_display),
                s.caption = coalesce(s.caption, row.src_display)

            MERGE (d:`{entity_label}` {{import_label: row.import_label, value: row.dst_value}})
            SET d:`{destination_label}`
            SET d.destination_fields = row.dst_fields,
                d.destination_key_fields = row.dst_key_fields,
                d.is_destination = true,
                d.name = row.dst_value,
                d.destination_display = row.dst_display,
                d.display = coalesce(d.display, row.dst_display),
                d.caption = coalesce(d.caption, row.dst_display)

            MERGE (e:`{event_label}` {{import_label: row.import_label, event_id: row.event_id}})
            SET e += row.event_props,
                e.import_label = row.import_label,
                e.name = row.event_display,
                e.display = row.event_display,
                e.caption = row.event_display,
                e.source_value = row.src_value,
                e.destination_value = row.dst_value,
                e.source_fields = row.src_fields,
                e.destination_fields = row.dst_fields,
                e.source_key_fields = row.src_key_fields,
                e.destination_key_fields = row.dst_key_fields,
                e.ts_datetime = CASE
                    WHEN row.ts_iso IS NULL THEN NULL
                    ELSE datetime(row.ts_iso)
                END

            MERGE (s)-[sr:`{src_event_rel}` {{event_id: row.event_id}}]->(e)
            SET sr.import_label = row.import_label,
                sr.name = '{src_event_rel}',
                sr.display = '{src_event_rel}',
                sr.caption = '{src_event_rel}'

            MERGE (e)-[dr:`{event_dst_rel}` {{event_id: row.event_id}}]->(d)
            SET dr.import_label = row.import_label,
                dr.name = '{event_dst_rel}',
                dr.display = '{event_dst_rel}',
                dr.caption = '{event_dst_rel}'
            """,
            rows=rows,
        ).consume()
        return

    rel_type = cypher_ident(labels["relationship"])
    aggregations = config["graph"].get("aggregations", [])
    agg_updates = aggregation_cypher(aggregations)
    agg_clause = f",\n            {agg_updates}" if agg_updates else ""
    rel_caption = relationship_caption_cypher()

    tx.run(
        f"""
        UNWIND $rows AS row

        MERGE (s:`{entity_label}` {{import_label: row.import_label, value: row.src_value}})
        SET s:`{source_label}`
        SET s.source_fields = row.src_fields,
            s.source_key_fields = row.src_key_fields,
            s.is_source = true,
            s.name = row.src_value,
            s.source_display = row.src_display,
            s.display = coalesce(s.display, row.src_display),
            s.caption = coalesce(s.caption, row.src_display)

        MERGE (d:`{entity_label}` {{import_label: row.import_label, value: row.dst_value}})
        SET d:`{destination_label}`
        SET d.destination_fields = row.dst_fields,
            d.destination_key_fields = row.dst_key_fields,
            d.is_destination = true,
            d.name = row.dst_value,
            d.destination_display = row.dst_display,
            d.display = coalesce(d.display, row.dst_display),
            d.caption = coalesce(d.caption, row.dst_display)

        MERGE (s)-[r:`{rel_type}` {{edge_key: row.edge_key}}]->(d)
        ON CREATE SET r.first_seen = row.ts_iso
        SET r += row.edge_props,
            r.import_label = row.import_label,
            r.source_fields = row.src_fields,
            r.destination_fields = row.dst_fields,
            r.source_key_fields = row.src_key_fields,
            r.destination_key_fields = row.dst_key_fields,
            r.last_seen = row.ts_iso,
            r.last_event_id = row.event_id,
            r.ts_datetime = CASE
                WHEN row.ts_iso IS NULL THEN NULL
                ELSE datetime(row.ts_iso)
            END{agg_clause}

        SET r.name = CASE WHEN {rel_caption} = '' THEN r.edge_key ELSE {rel_caption} END,
            r.display = CASE WHEN {rel_caption} = '' THEN r.edge_key ELSE {rel_caption} END,
            r.caption = CASE WHEN {rel_caption} = '' THEN r.edge_key ELSE {rel_caption} END
        """,
        rows=rows,
    ).consume()


def import_records(config: dict[str, Any], dry_run: bool = False) -> int:
    from pathlib import Path

    paths = [Path(path) for path in config["input"]["paths"]]
    labels = labels_from_config(config)
    batch_size = int(config["input"].get("batch_size", 500))

    if dry_run:
        import json

        records = sample_records(paths, 5)
        print_preview(records)
        print("\nDry run: no Neo4j writes.")
        print(
            json.dumps(
                {
                    "labels": labels,
                    "entity_label": labels["entity"],
                    "source_fields": config["graph"]["source_fields"],
                    "destination_fields": config["graph"]["destination_fields"],
                    "source_node_key_fields": config["graph"].get("source_node_key_fields") or config["graph"]["source_fields"],
                    "destination_node_key_fields": config["graph"].get("destination_node_key_fields") or config["graph"]["destination_fields"],
                    "edge_mode": config["graph"]["edge_mode"],
                    "timestamp_enabled": config["graph"].get("timestamp_enabled"),
                    "timestamp_field": config["graph"].get("timestamp_field"),
                    "timestamp_format": config["graph"].get("timestamp_format"),
                    "timestamp_python_format": config["graph"].get("timestamp_python_format"),
                    "timestamp_timezone": config["graph"].get("timestamp_timezone"),
                    "aggregations": config["graph"].get("aggregations", []),
                },
                indent=2,
            )
        )
        return 0

    driver = get_driver(config)

    try:
        if config["neo4j"].get("create_database"):
            ensure_database(driver, config["neo4j"]["database"])

        with driver.session(database=config["neo4j"]["database"]) as session:
            create_constraints(session, labels)

            batch: list[dict[str, Any]] = []
            imported = 0

            for path, line_no, record in iter_jsonl(paths):
                row = build_row(record, config, path, line_no)

                if row is None:
                    continue

                batch.append(row)

                if len(batch) >= batch_size:
                    session.execute_write(write_batch, batch, labels, config)
                    imported += len(batch)
                    print(f"Imported: {imported} events", file=sys.stderr)
                    batch = []

            if batch:
                session.execute_write(write_batch, batch, labels, config)
                imported += len(batch)

            return imported

    finally:
        driver.close()


def delete_import(config: dict[str, Any]) -> tuple[int, int]:
    driver = get_driver(config)

    try:
        with driver.session(database=config["neo4j"]["database"]) as session:
            total_rels = 0
            total_nodes = 0

            while True:
                deleted = session.run(
                    """
                    MATCH ()-[r]->()
                    WHERE r.import_label = $import_label
                    WITH r LIMIT $limit
                    DELETE r
                    RETURN count(*) AS deleted
                    """,
                    import_label=config["graph"]["import_label"],
                    limit=5000,
                ).single()["deleted"]

                total_rels += int(deleted)

                if not deleted:
                    break

            while True:
                deleted = session.run(
                    """
                    MATCH (n)
                    WHERE n.import_label = $import_label
                    WITH n LIMIT $limit
                    DETACH DELETE n
                    RETURN count(*) AS deleted
                    """,
                    import_label=config["graph"]["import_label"],
                    limit=5000,
                ).single()["deleted"]

                total_nodes += int(deleted)

                if not deleted:
                    break

            return total_nodes, total_rels

    finally:
        driver.close()
