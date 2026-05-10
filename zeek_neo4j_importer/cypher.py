from __future__ import annotations

from .identifiers import cypher_ident, property_key


def aggregation_cypher(aggregations: list[dict[str, str]]) -> str:
    lines = []

    for agg in aggregations:
        op = agg.get("op")
        name = property_key(agg.get("name") or f"{op}_{agg.get('field', '')}")

        if op == "count":
            lines.append(f"r.`{cypher_ident(name)}` = coalesce(r.`{cypher_ident(name)}`, 0) + row.agg_values.`{cypher_ident(name)}`")

        elif op == "sum":
            lines.append(
                f"r.`{cypher_ident(name)}` = coalesce(r.`{cypher_ident(name)}`, 0.0) + coalesce(row.agg_values.`{cypher_ident(name)}`, 0.0)"
            )

        elif op == "avg":
            sum_name = f"{name}_sum"
            count_name = f"{name}_count"
            value_expr = f"row.agg_values.`{cypher_ident(name)}`"
            new_count_expr = (
                f"coalesce(r.`{cypher_ident(count_name)}`, 0) + "
                f"CASE WHEN {value_expr} IS NULL THEN 0 ELSE 1 END"
            )
            new_sum_expr = f"coalesce(r.`{cypher_ident(sum_name)}`, 0.0) + coalesce({value_expr}, 0.0)"

            lines.extend(
                [
                    f"r.`{cypher_ident(sum_name)}` = {new_sum_expr}",
                    f"r.`{cypher_ident(count_name)}` = {new_count_expr}",
                    f"r.`{cypher_ident(name)}` = CASE WHEN {new_count_expr} = 0 THEN NULL ELSE ({new_sum_expr}) / ({new_count_expr}) END",
                ]
            )

    return ",\n            ".join(lines)


def relationship_caption_cypher() -> str:
    return (
        "reduce(caption = '', field IN row.edge_caption_fields | "
        "caption + CASE "
        "WHEN r[field] IS NULL THEN '' "
        "WHEN caption = '' THEN field + '=' + toString(r[field]) "
        "ELSE ' | ' + field + '=' + toString(r[field]) END)"
    )
