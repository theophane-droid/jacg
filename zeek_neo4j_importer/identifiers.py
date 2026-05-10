from __future__ import annotations

import re


def sanitize_identifier(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_]", "_", value.strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")

    if not cleaned:
        cleaned = fallback
    if cleaned[0].isdigit():
        cleaned = f"{fallback}_{cleaned}"

    return cleaned


def property_key(field: str) -> str:
    return sanitize_identifier(field, "field").lower()


def cypher_ident(value: str) -> str:
    return value.replace("`", "``")


def label_from_fields(fields: list[str], fallback: str) -> str:
    if not fields:
        return fallback
    return sanitize_identifier("_".join(fields), fallback)


def role_label_from_fields(role: str, fields: list[str], fallback: str) -> str:
    return sanitize_identifier(f"{role}_{label_from_fields(fields, fallback)}", fallback)


def relationship_from_fields(source_fields: list[str], destination_fields: list[str]) -> str:
    source = label_from_fields(source_fields, "Source")
    destination = label_from_fields(destination_fields, "Destination")
    return sanitize_identifier(f"{source}_TO_{destination}", "OBSERVED").upper()
