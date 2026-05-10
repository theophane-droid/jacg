from __future__ import annotations

import glob
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


def flatten_json(record: dict[str, Any], prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}

    for key, value in record.items():
        full_key = f"{prefix}.{key}" if prefix else str(key)

        if isinstance(value, dict):
            flat.update(flatten_json(value, full_key))
        elif isinstance(value, list):
            flat[full_key] = [
                item if isinstance(item, (str, int, float, bool)) or item is None else json.dumps(item, sort_keys=True)
                for item in value
            ]
        else:
            flat[full_key] = value

    return flat


def add_field_aliases(record: dict[str, Any]) -> dict[str, Any]:
    aliased = dict(record)

    for key, value in list(record.items()):
        if "." in key:
            aliased.setdefault(key.replace(".", "_"), value)
        elif "_" in key:
            parts = key.split("_")
            if parts[0] == "id" and len(parts) >= 3:
                aliased.setdefault(f"id.{parts[1]}_{'_'.join(parts[2:])}", value)

    return aliased


def iter_jsonl(paths: Iterable[Path]) -> Iterable[tuple[Path, int, dict[str, Any]]]:
    for path in paths:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line_no, line in enumerate(handle, start=1):
                line = line.strip()

                if not line:
                    continue

                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc

                if isinstance(record, dict):
                    flattened = flatten_json(record)
                    flattened["_path"] = str(path)
                    flattened["_line"] = line_no
                    yield path, line_no, add_field_aliases(flattened)


def sample_records(paths: list[Path], limit: int) -> list[dict[str, Any]]:
    records = []

    for _, _, record in iter_jsonl(paths):
        records.append(record)
        if len(records) >= limit:
            break

    return records


def preview_fields(records: list[dict[str, Any]]) -> list[tuple[str, int, list[str]]]:
    counts: Counter[str] = Counter()
    examples: dict[str, list[str]] = defaultdict(list)

    for record in records:
        for key, value in record.items():
            counts[key] += 1
            rendered = json.dumps(value, ensure_ascii=False, default=str)

            if len(rendered) > 70:
                rendered = rendered[:67] + "..."

            if rendered not in examples[key] and len(examples[key]) < 3:
                examples[key].append(rendered)

    return [(field, count, examples[field]) for field, count in counts.most_common()]


def print_preview(records: list[dict[str, Any]]) -> None:
    if not records:
        print("No JSONL records found.")
        return

    print(f"\nField preview ({len(records)} sampled rows)")
    print("-" * 100)

    for idx, (field, count, examples) in enumerate(preview_fields(records), start=1):
        print(f"{idx:>3}. {field:<32} rows={count:<4} examples={'; '.join(examples)}")


def expand_paths(values: list[str]) -> list[Path]:
    paths: list[Path] = []

    for value in values:
        matches = [Path(match) for match in sorted(glob.glob(value))]
        candidates = matches if matches else [Path(value)]

        for path in candidates:
            if path.is_dir():
                paths.extend(sorted(path.glob("*.jsonl")))
                paths.extend(sorted(path.glob("*.log")))
            else:
                paths.append(path)

    seen: set[Path] = set()
    paths = [path for path in paths if not (path in seen or seen.add(path))]

    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Files not found: {', '.join(missing)}")

    if not paths and values:
        raise FileNotFoundError(f"No files matched: {', '.join(values)}")

    return paths
