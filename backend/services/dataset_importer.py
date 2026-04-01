import csv
import io
import json
from typing import Any


INPUT_KEYS = ("input", "prompt", "question", "text", "input_text")
EXPECTED_OUTPUT_KEYS = (
    "expected_output",
    "expectedoutput",
    "expected",
    "reference",
    "answer",
    "target",
    "output",
)
CONTEXT_KEYS = ("context", "metadata", "notes")
DIFFICULTY_KEYS = ("difficulty", "level")
TAGS_KEYS = ("tags", "tag")


def parse_dataset_import(import_format: str, content: str) -> list[dict[str, Any]]:
    if import_format == "json":
        return _parse_json_items(content)
    if import_format == "csv":
        return _parse_csv_items(content)
    raise ValueError("Unsupported import format. Use 'json' or 'csv'.")


def _parse_json_items(content: str) -> list[dict[str, Any]]:
    try:
        loaded = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON near line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc

    if isinstance(loaded, dict):
        items = loaded.get("items")
    else:
        items = loaded

    if not isinstance(items, list):
        raise ValueError("JSON imports must be an array of items or an object with an 'items' array.")

    normalized_items = []
    for index, raw_item in enumerate(items, start=1):
        if not isinstance(raw_item, dict):
            raise ValueError(f"JSON item {index} must be an object.")
        normalized_items.append(_normalize_item(raw_item, f"JSON item {index}"))
    if not normalized_items:
        raise ValueError("Imported dataset must contain at least one item.")
    return normalized_items


def _parse_csv_items(content: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    if not reader.fieldnames:
        raise ValueError("CSV import requires a header row.")

    lowered_fieldnames = [str(field).strip().lower() for field in reader.fieldnames if field]
    has_input = any(key in lowered_fieldnames for key in INPUT_KEYS)
    has_expected_output = any(key in lowered_fieldnames for key in EXPECTED_OUTPUT_KEYS)
    if not has_input or not has_expected_output:
        raise ValueError(
            "CSV header must include an input column and an expected_output column "
            "(supported aliases: input/prompt/question and expected_output/reference/answer/target)."
        )

    normalized_rows = []
    for row_number, row in enumerate(reader, start=2):
        lowered = {str(key).strip().lower(): value for key, value in row.items() if key is not None}
        if not any(_stringify(value).strip() for value in lowered.values()):
            continue
        normalized_rows.append(_normalize_item(lowered, f"CSV row {row_number}"))

    if not normalized_rows:
        raise ValueError("CSV import did not contain any usable rows.")
    return normalized_rows


def _normalize_item(raw_item: dict[str, Any], item_label: str) -> dict[str, Any]:
    normalized = {str(key).strip().lower(): value for key, value in raw_item.items()}

    input_text = _pick_first(normalized, INPUT_KEYS)
    expected_output = _pick_first(normalized, EXPECTED_OUTPUT_KEYS)

    if not input_text:
        raise ValueError(f"{item_label} is missing an input field.")
    if not expected_output:
        raise ValueError(f"{item_label} is missing an expected output field.")

    context_value = _pick_first(normalized, CONTEXT_KEYS, allow_blank=True)
    difficulty = _pick_first(normalized, DIFFICULTY_KEYS, allow_blank=True)
    tags = _parse_tags(_pick_first(normalized, TAGS_KEYS, allow_blank=True, raw=True))

    known_keys = set(INPUT_KEYS) | set(EXPECTED_OUTPUT_KEYS) | set(CONTEXT_KEYS) | set(DIFFICULTY_KEYS) | set(TAGS_KEYS)
    extras = {
        key: value
        for key, value in normalized.items()
        if key not in known_keys and _stringify(value).strip()
    }

    context = _normalize_context(context_value, extras)

    item: dict[str, Any] = {
        "input": input_text,
        "expected_output": expected_output,
        "context": context,
        "tags": tags,
        "difficulty": difficulty or None,
    }
    return item


def _pick_first(
    raw_item: dict[str, Any],
    keys: tuple[str, ...],
    *,
    allow_blank: bool = False,
    raw: bool = False,
) -> Any:
    for key in keys:
        if key not in raw_item:
            continue
        value = raw_item[key]
        if raw:
            return value
        text = _stringify(value).strip()
        if text or allow_blank:
            return text
    return None


def _normalize_context(value: Any, extras: dict[str, Any]) -> str | None:
    base_context: str | None = None
    if isinstance(value, (dict, list)):
        base_context = json.dumps(value)
    else:
        text = _stringify(value).strip()
        base_context = text or None

    if not extras:
        return base_context
    if base_context:
        return base_context
    return json.dumps(extras)


def _parse_tags(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value

    text = _stringify(value).strip()
    if not text:
        return None

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        parts = [part.strip() for part in text.split(",") if part.strip()]
        return parts or text


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        return json.dumps(value)
    return str(value)
