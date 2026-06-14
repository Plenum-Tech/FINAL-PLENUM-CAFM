"""Dataset semantic description via Claude Haiku.

Strategy 4 fallback: When Strategies 1-3 (exact/alias/regex) don't provide
sufficient confidence, Haiku provides semantic field descriptions.
"""

import json
import logging
from typing import Optional

from anthropic import AsyncAnthropic

from cafm_shared.logging import get_logger
logger = get_logger(__name__)


async def describe_dataset(
    df_head_str: str,
    column_names: list[str],
    client: AsyncAnthropic,
) -> dict[str, str]:
    """
    Generate semantic descriptions for each column using Claude Haiku.

    Single Haiku call with structured output. OTel span tagged with node1 + dataset_description.

    Args:
        df_head_str: String representation of first 5 rows (pandas.to_string())
        column_names: List of column names from the dataframe
        client: Async Anthropic client

    Returns:
        dict[column_name] = "semantic description" (max 20 words per column)
    """

    prompt = f"""Analyze this dataset and describe each column semantically.

Columns: {', '.join(column_names)}

Sample data (first 5 rows):
{df_head_str}

Return a JSON object with column names as keys and semantic descriptions (max 20 words) as values.
Focus on: what data type, what business meaning, common values.

Example:
{{
  "asset_code": "Unique identifier for equipment/assets",
  "open_work_orders": "Count of unresolved maintenance requests"
}}

Return ONLY valid JSON, no markdown, no explanation."""

    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
        )

        # Extract JSON from response
        if not response.content or not response.content[0]:
            logger.warning(f"Haiku returned empty response content")
            return _fallback_descriptions(column_names)

        response_text = response.content[0].text.strip() if hasattr(response.content[0], 'text') else ""

        if not response_text:
            logger.warning(f"Haiku returned empty text body (response.content[0].text is empty)")
            return _fallback_descriptions(column_names)

        logger.debug(f"Haiku raw response (first 200 chars): {response_text[:200]}")

        # Try to parse as JSON
        try:
            descriptions = json.loads(response_text)
        except json.JSONDecodeError as e:
            # Maybe it's wrapped in markdown code blocks
            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
                descriptions = json.loads(response_text)
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()
                descriptions = json.loads(response_text)
            else:
                raise

        # Ensure all columns are in the result
        result = {}
        for col in column_names:
            result[col] = descriptions.get(col, "Unknown field type")

        logger.info(f"Dataset descriptions generated for {len(column_names)} columns")
        return result

    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse Haiku response as JSON: {e}. Using fallback descriptions.")
        # Fallback: generic descriptions based on column name patterns
        return _fallback_descriptions(column_names)

    except Exception as e:
        logger.error(f"Failed to call Haiku for dataset description: {e}. Using fallback descriptions.")
        return _fallback_descriptions(column_names)


def _name_match_table(table_name: str, cafm_tables: list[str]) -> Optional[str]:
    """Match a source sheet/table name to a real plenum_cafm table.

    Singular/plural/space-or-underscore tolerant (e.g. "Work Orders" → work_orders,
    "sites" → sites). Returns the real CAFM table name, or None if no name match.
    """
    t = table_name.lower().strip()
    variants = {t, t.replace(" ", "_"), t.rstrip("s"), t.replace(" ", "_").rstrip("s")}
    for tgt in cafm_tables:
        tl = tgt.lower()
        if tl in variants or tl.rstrip("s") in variants:
            return tgt
    return None


async def match_tables_to_cafm(
    source_tables: dict[str, list[str]],
    cafm_tables: list[str],
    client: AsyncAnthropic,
) -> dict[str, Optional[str]]:
    """Map each source sheet/table to the best-fitting plenum_cafm table.

    Two-pass, mirrors the deterministic mapper's table routing:
      1. Deterministic name match (singular/plural/space tolerant).
      2. One Haiku call for the leftovers (e.g. "sites_2" → "sites"), using the
         sheet's column names as the signal.

    Only ever returns a table that actually exists in ``cafm_tables`` (or None),
    so the LLM can't invent a target. Non-fatal: on any error the unmatched
    sheets resolve to None and the card simply shows "no match".

    Args:
        source_tables: {sheet_name: [column names]}
        cafm_tables:   real plenum_cafm table names
        client:        Async Anthropic client

    Returns:
        {sheet_name: cafm_table_name | None}
    """
    matches: dict[str, Optional[str]] = {}
    cafm_by_lower = {t.lower(): t for t in cafm_tables}

    unmatched: dict[str, list[str]] = {}
    for tname, cols in source_tables.items():
        hit = _name_match_table(tname, cafm_tables)
        if hit:
            matches[tname] = hit
        else:
            unmatched[tname] = cols

    if not unmatched or not cafm_tables:
        for tname in unmatched:
            matches.setdefault(tname, None)
        return matches

    sheets_block = "\n".join(
        f"- {name}: {', '.join(cols[:25]) or '(no columns)'}"
        for name, cols in unmatched.items()
    )
    prompt = f"""You are matching spreadsheet sheets to the closest existing database table.

Target database tables (choose ONLY from this list, or null if none fit):
{', '.join(cafm_tables)}

Sheets to match (name + sample columns):
{sheets_block}

For each sheet, pick the single best-fitting target table by meaning of the
columns (e.g. a sheet named "sites_2" with site columns → "sites"). If nothing
fits, use null.

Return ONLY a JSON object mapping each sheet name to a target table name or null.
Example: {{"sites_2": "sites", "misc_notes": null}}"""

    try:
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = (
            response.content[0].text.strip()
            if response.content and hasattr(response.content[0], "text")
            else ""
        )
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()
        parsed = json.loads(response_text) if response_text else {}
    except Exception as e:  # noqa: BLE001 — non-fatal, fall back to no match
        logger.warning(f"match_tables_to_cafm: Haiku table match failed ({e}); leaving unmatched")
        parsed = {}

    for tname in unmatched:
        raw = parsed.get(tname)
        # Only keep matches to tables that genuinely exist (case-insensitive).
        matches[tname] = cafm_by_lower.get(str(raw).lower()) if raw else None

    return matches


def _fallback_descriptions(column_names: list[str]) -> dict[str, str]:
    """
    Fallback: Generate generic descriptions based on column name patterns.

    Used if Haiku call fails or returns unparseable JSON.
    """
    result = {}
    for col in column_names:
        lower = col.lower()
        if any(x in lower for x in ["code", "id", "num", "number"]):
            result[col] = "Unique identifier or reference code"
        elif any(x in lower for x in ["name", "description", "desc", "title"]):
            result[col] = "Text description or human-readable name"
        elif any(x in lower for x in ["date", "time", "datetime", "ts", "created", "due"]):
            result[col] = "Date or timestamp value"
        elif any(x in lower for x in ["qty", "quantity", "count", "number", "amount"]):
            result[col] = "Numeric quantity or count"
        elif any(x in lower for x in ["status", "state", "priority", "level", "type"]):
            result[col] = "Categorical value (enum)"
        else:
            result[col] = "Text or numeric field"
    return result
