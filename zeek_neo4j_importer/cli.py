from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .config import apply_dotenv_to_config, load_config, merge_dict, write_example_config
from .defaults import DEFAULT_CONFIG
from .interactive import interactive_config
from .jsonl import expand_paths, print_preview, sample_records
from .neo4j_client import delete_import, import_records, recreate_database
from .pipeline import load_pipeline, run_pipeline
from .profiles import PROFILE_DIR, load_profile, migrate_all_profiles


def log_info(message: str) -> None:
    print(f"[+] {message}", file=sys.stderr)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Push Zeek JSONL logs into Neo4j as a source-event-destination graph.")
    parser.add_argument("paths", nargs="*", help="JSONL/log file(s) or directories containing .jsonl/.log files")
    parser.add_argument("--config", type=Path, help="JSON configuration file to use")
    parser.add_argument("--pipeline", type=Path, help="Pipeline JSON file with several sourcetype/profile imports")
    parser.add_argument("--profile", help="Netgraph profile name or path to use")
    parser.add_argument("--tui", action="store_true", help="Interactive terminal configuration")
    parser.add_argument("--preview", action="store_true", help="Only show the field preview")
    parser.add_argument("--dry-run", action="store_true", help="Validate the config without writing to Neo4j")
    parser.add_argument("--init-config", type=Path, help="Create an example configuration file")
    parser.add_argument("--delete-import", action="store_true", help="Delete nodes and edges inserted for this import_label")
    parser.add_argument(
        "--recreate-database",
        action="store_true",
        help="Drop and recreate the configured Neo4j database, or clear the default neo4j database.",
    )
    parser.add_argument("--migrate-profiles", action="store_true", help="Migrate netgraph_profiles/*.json to the event-node model")
    return parser.parse_args()


def resolve_profile(value: str) -> Path:
    path = Path(value)

    if path.exists():
        return path

    if path.suffix != ".json":
        path = path.with_suffix(".json")

    candidate = PROFILE_DIR / path
    if candidate.exists():
        return candidate

    raise SystemExit(f"Profile not found: {value}")


def main() -> int:
    args = parse_args()

    if args.init_config:
        write_example_config(args.init_config)
        print(f"Example config written: {args.init_config}")
        return 0

    if args.migrate_profiles:
        changed = migrate_all_profiles()
        if changed:
            print("Migrated profiles:")
            for path in changed:
                print(f"  - {path}")
        else:
            print("No profiles migrated.")
        return 0

    if args.recreate_database and args.pipeline:
        log_info(f"Loading pipeline config '{args.pipeline}'")
        pipeline = load_pipeline(args.pipeline)
        pipeline = apply_dotenv_to_config(pipeline)
        log_info("Recreating configured Neo4j database")
        result = recreate_database(pipeline)
        print(
            f"Recreated database '{result['database']}' "
            f"using mode '{result['mode']}'. "
            f"Deleted nodes: {result['deleted_nodes']}, "
            f"deleted relationships: {result.get('deleted_relationships', 0)}, "
            f"dropped constraints: {result['dropped_constraints']}, "
            f"dropped indexes: {result['dropped_indexes']}."
        )

        return 0

    if args.pipeline:
        log_info(f"Loading pipeline config '{args.pipeline}'")
        pipeline = load_pipeline(args.pipeline)
        pipeline = apply_dotenv_to_config(pipeline)
        stats = run_pipeline(pipeline, dry_run=args.dry_run)

        if args.dry_run:
            print("Pipeline dry run complete.")
        else:
            print(
                "Pipeline complete: "
                f"{stats['imported']} events imported, "
                f"{stats['skipped']} source(s) skipped, "
                f"{stats['failed']} source(s) failed."
            )

        return 0

    if args.config:
        log_info(f"Loading config '{args.config}'")
        config = load_config(args.config)
        config = apply_dotenv_to_config(config)
        paths = expand_paths(config["input"]["paths"])
    else:
        if not args.paths and not args.delete_import and not args.recreate_database:
            raise SystemExit("Provide at least one JSONL/log file, or use --config / --init-config.")

        paths = expand_paths(args.paths) if args.paths else []
        config = merge_dict(DEFAULT_CONFIG, {})
        config["input"]["paths"] = [str(path) for path in paths]
        config = apply_dotenv_to_config(config)

    if args.profile:
        log_info(f"Loading profile '{args.profile}'")
        profile_path = resolve_profile(args.profile)
        config = merge_dict(config, load_profile(profile_path))
        config["input"]["paths"] = [str(path) for path in paths]

    if args.preview:
        print_preview(sample_records(paths, int(config["input"]["sample_size"])))
        return 0

    if args.tui or (not args.config and not args.delete_import and not args.dry_run and sys.stdin.isatty()):
        config = interactive_config(paths, config)

    if args.delete_import:
        nodes, rels = delete_import(config)
        print(f"Deleted import '{config['graph']['import_label']}': {nodes} nodes, {rels} relationships.")
        return 0

    if args.recreate_database:
        log_info("Recreating configured Neo4j database")
        result = recreate_database(config)
        print(
            f"Recreated database '{result['database']}' "
            f"using mode '{result['mode']}'. "
            f"Deleted nodes: {result['deleted_nodes']}, "
            f"deleted relationships: {result.get('deleted_relationships', 0)}, "
            f"dropped constraints: {result['dropped_constraints']}, "
            f"dropped indexes: {result['dropped_indexes']}."
        )
        return 0

    imported = import_records(config, dry_run=args.dry_run)

    if args.dry_run:
        print("Dry run complete.")
    else:
        print(f"Done: {imported} events imported.")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit("\nInterrupted.")
