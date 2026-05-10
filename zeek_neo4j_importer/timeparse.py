from __future__ import annotations

import datetime as dt
from typing import Any


def parse_datetime_value(value: Any, graph: dict[str, Any]) -> str | None:
    """
    Return an ISO-8601 UTC string usable with Cypher datetime(...).

    Supported formats:
      - none
      - epoch_float
      - epoch_int
      - iso
      - python
    """
    if not graph.get("timestamp_enabled", True):
        return None

    if value in (None, ""):
        return None

    timestamp_format = graph.get("timestamp_format", "epoch_float")
    timezone_name = graph.get("timestamp_timezone", "UTC") or "UTC"

    if timestamp_format == "none":
        return None

    tzinfo: dt.tzinfo = dt.timezone.utc

    if timezone_name.upper() != "UTC":
        try:
            from zoneinfo import ZoneInfo

            tzinfo = ZoneInfo(timezone_name)
        except Exception:
            tzinfo = dt.timezone.utc

    try:
        if timestamp_format == "epoch_float":
            parsed = dt.datetime.fromtimestamp(float(value), tz=dt.timezone.utc)
            return parsed.isoformat()

        if timestamp_format == "epoch_int":
            parsed = dt.datetime.fromtimestamp(int(value), tz=dt.timezone.utc)
            return parsed.isoformat()

        if timestamp_format == "iso":
            raw = str(value)
            if raw.endswith("Z"):
                raw = raw[:-1] + "+00:00"

            parsed = dt.datetime.fromisoformat(raw)

            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=tzinfo)

            return parsed.astimezone(dt.timezone.utc).isoformat()

        if timestamp_format == "python":
            fmt = graph.get("timestamp_python_format")
            if not fmt:
                return None

            parsed = dt.datetime.strptime(str(value), fmt)

            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=tzinfo)

            return parsed.astimezone(dt.timezone.utc).isoformat()

    except Exception:
        return None

    return None
