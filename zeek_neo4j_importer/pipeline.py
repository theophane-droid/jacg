from __future__ import annotations

import glob
import json
import sys
from pathlib import Path
from typing import Any

from .config import merge_dict, normalize_config
from .defaults import DEFAULT_CONFIG
from .neo4j_client import import_records
from .profiles import PROFILE_DIR, load_profile


def log_info(message: str) -> None:
    print(f"[+] {message}", file=sys.stderr)


def warn(message: str) -> None:
    print(f"WARNING: {message}", file=sys.stderr)


def resolve_profile(value: str) -> Path:
    path = Path(value)

    if path.exists():
        return path

    if path.suffix != ".json":
        path = path.with_suffix(".json")

    candidate = PROFILE_DIR / path
    if candidate.exists():
        return candidate

    raise FileNotFoundError(f"Profile not found: {value}")


def expand_existing_paths(values: list[str]) -> list[Path]:
    paths: list[Path] = []

    for value in values:
        matches = [Path(match) for match in sorted(glob.glob(value))]

        if not matches:
            if Path(value).exists():
                matches = [Path(value)]
            else:
                warn(f"No files matched '{value}', skipping this pattern.")
                continue

        for path in matches:
            if path.is_dir():
                children = sorted(path.glob("*.jsonl")) + sorted(path.glob("*.log"))
                if children:
                    paths.extend(children)
                else:
                    warn(f"No .jsonl/.log files found in '{path}', skipping this directory.")
            elif path.exists():
                paths.append(path)
            else:
                warn(f"File '{path}' does not exist, skipping it.")

    seen: set[Path] = set()
    return [path for path in paths if not (path in seen or seen.add(path))]


def load_pipeline(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))

    if not isinstance(data.get("sources"), list):
        raise ValueError("Pipeline config must contain a 'sources' list.")

    return data


def pipeline_base_config(pipeline: dict[str, Any]) -> dict[str, Any]:
    reserved = {"sources", "jobs"}
    base = {key: value for key, value in pipeline.items() if key not in reserved}
    return merge_dict(DEFAULT_CONFIG, base)


def source_paths(source: dict[str, Any]) -> list[str]:
    values = source.get("paths", source.get("path", []))

    if isinstance(values, str):
        return [values]

    if isinstance(values, list):
        return [str(value) for value in values]

    raise ValueError("Pipeline source paths must be a string or a list of strings.")


def build_source_config(base_config: dict[str, Any], source: dict[str, Any], paths: list[Path]) -> dict[str, Any]:
    if not source.get("profile"):
        raise ValueError("Pipeline source is missing required 'profile'.")

    config = merge_dict(base_config, {})
    config = merge_dict(config, load_profile(resolve_profile(str(source["profile"]))))

    overrides = {key: value for key, value in source.items() if key not in {"name", "profile", "path", "paths"}}
    config = merge_dict(config, overrides)
    config["input"]["paths"] = [str(path) for path in paths]

    return normalize_config(config)


def run_pipeline(config: dict[str, Any], dry_run: bool = False) -> dict[str, int]:
    base_config = pipeline_base_config(config)
    sources = config["sources"]
    imported_total = 0
    skipped = 0
    failed = 0

    log_info(f"Starting pipeline with {len(sources)} source(s)")

    for idx, source in enumerate(sources, start=1):
        if not isinstance(source, dict):
            raise ValueError(f"Pipeline source #{idx} must be an object.")

        name = source.get("name") or source.get("profile") or f"source_{idx}"
        paths = expand_existing_paths(source_paths(source))

        if not paths:
            warn(f"Source '{name}' has no existing input files, skipping it.")
            skipped += 1
            continue

        try:
            source_config = build_source_config(base_config, source, paths)
            log_info(f"Importing source '{name}' with profile '{source['profile']}' ({len(paths)} file(s))")
            imported_total += import_records(source_config, dry_run=dry_run)
            log_info(f"Finished source '{name}'")
        except Exception as exc:
            failed += 1
            warn(f"Source '{name}' failed: {exc}")
            if not config.get("continue_on_error", False):
                raise

    return {
        "imported": imported_total,
        "skipped": skipped,
        "failed": failed,
        "sources": len(sources),
    }
