"""Adapter rules interpreter (G4).

Turns a declarative adapter-rules document plus stored artifact bytes into field
observations. It never produces governed entities — that is the materializer's job, behind
resolution and lineage.

Two behaviours are load-bearing:

* **Drift is quarantined, not absorbed.** Fallback selectors exist so a template change
  does not silently destroy data, but using one is evidence that the page changed. Any
  fallback hit marks the parse ``quarantined_schema_drift``. The rows are still written as
  observations so a human can see what changed; they simply do not pass as a clean parse.
* **Counts are independent.** ``structural_count`` is measured with its own selector rather
  than by counting extracted rows, so the terminal-state calculator's
  ``extracted_count != structural_count`` check compares two genuinely separate
  measurements instead of a number against itself.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional, Sequence

from lxml import etree, html as lxml_html

RULES_SCHEMA_NAME = "adapter-rules.schema.json"
OUTPUT_CONTRACT_VERSION = "2.1"

# Implicit ARIA roles this interpreter understands for the ``role_text`` strategy.
_IMPLICIT_ROLES = {
    "a": "link", "button": "button", "h1": "heading", "h2": "heading", "h3": "heading",
    "h4": "heading", "h5": "heading", "h6": "heading", "table": "table", "ul": "list",
    "ol": "list", "li": "listitem", "img": "img", "nav": "navigation", "main": "main",
    "article": "article", "form": "form", "input": "textbox", "select": "combobox",
}


class AdapterError(RuntimeError):
    pass


class SelectorMiss(AdapterError):
    """Every strategy for a selector failed."""


@dataclass(frozen=True)
class Hit:
    value: str
    locator: str
    evidence_quote: str
    used_fallback: bool
    strategy: str
    normalized: Optional[str] = None
    normalization_state: str = "not_requested"


@dataclass
class ParsedRecord:
    source_record_key: str
    row_ordinal: int
    record_locator: str
    fields: dict[str, list[Hit]] = field(default_factory=dict)


@dataclass
class ParseOutcome:
    records: list[ParsedRecord]
    structural_count: Optional[int]
    published_count: Optional[int]
    container_resolved: bool
    drift: bool
    drift_detail: list[str]
    rejects: list[str]
    empty_is_valid: bool

    @property
    def status(self) -> str:
        """The parse_run status this outcome justifies."""
        if not self.container_resolved:
            return "quarantined_schema_drift"
        if self.drift:
            return "quarantined_schema_drift"
        return "parsed"


# -- document adapters ----------------------------------------------------------------


class Document:
    """A parsed artifact, exposing whatever the selector strategies need."""

    def __init__(self, *, tree=None, data: Any = None, lines: Optional[Sequence[str]] = None,
                 text: str = ""):
        self.tree = tree
        self.data = data
        self.lines = list(lines or [])
        self.text = text


def load_document(body: bytes, *, content_type: Optional[str] = None,
                  route_kind: Optional[str] = None) -> Document:
    kind = _document_kind(content_type, route_kind, body)
    if kind == "json":
        payload = json.loads(body.decode("utf-8"))
        return Document(data=payload, text=body.decode("utf-8", errors="replace"))
    if kind == "pdf":
        text = extract_pdf_text(body)
        return Document(lines=text.splitlines(), text=text)
    if kind == "csv":
        text = decode_text(body, content_type)
        return Document(lines=text.splitlines(), text=text)
    tree = lxml_html.fromstring(decode_text(body, content_type))
    return Document(tree=tree, text=tree.text_content())


_META_CHARSET = re.compile(
    rb"""<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)""", re.IGNORECASE
)


def decode_text(body: bytes, content_type: Optional[str] = None) -> str:
    """Decode bytes to text using the documented precedence, not a guess.

    Handing raw bytes to lxml lets it fall back to a Latin-1-ish default, which turns UTF-8
    "GBP" into mojibake and quietly corrupts every name with a diacritic — the Latvian,
    Estonian and Norwegian centres this instrument exists to read. Order: BOM, then the
    HTTP charset parameter, then an in-document meta charset, then UTF-8, then cp1252 as
    the last resort that cannot itself fail.
    """
    for bom, encoding in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16"),
                          (b"\xfe\xff", "utf-16")):
        if body.startswith(bom):
            return body.decode(encoding, errors="replace")

    candidates: list[str] = []
    if content_type and "charset=" in content_type.lower():
        candidates.append(
            content_type.lower().split("charset=", 1)[1].split(";")[0].strip().strip('"\'')
        )
    meta = _META_CHARSET.search(body[:4096])
    if meta:
        candidates.append(meta.group(1).decode("ascii", errors="ignore"))
    candidates.extend(("utf-8", "cp1252"))

    for encoding in candidates:
        if not encoding:
            continue
        try:
            return body.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return body.decode("utf-8", errors="replace")


def _document_kind(content_type: Optional[str], route_kind: Optional[str],
                   body: bytes) -> str:
    head = (content_type or "").split(";")[0].strip().lower()
    if head in ("application/json", "text/json") or head.endswith("+json"):
        return "json"
    if head == "application/pdf" or body[:5] == b"%PDF-":
        return "pdf"
    if head in ("text/csv", "application/csv"):
        return "csv"
    if route_kind == "pdf":
        return "pdf"
    if route_kind in ("api", "json"):
        return "json"
    return "html"


def extract_pdf_text(body: bytes) -> str:
    """Extract text from a PDF. Requires the optional ``pypdf`` dependency."""
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - depends on install profile
        raise AdapterError(
            "PDF routes require the optional dependency 'pypdf'; install it with "
            "`pip install pypdf` or exclude pdf routes from the universe"
        ) from exc
    import io

    reader = PdfReader(io.BytesIO(body))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


# -- selector strategies ---------------------------------------------------------------


def _css_to_xpath(selector: str) -> str:
    from cssselect import GenericTranslator

    return GenericTranslator().css_to_xpath(selector)


def _node_text(node) -> str:
    if isinstance(node, str):
        return node.strip()
    return (node.text_content() if hasattr(node, "text_content") else str(node)).strip()


def _node_locator(node, base: str) -> str:
    if isinstance(node, str) or not hasattr(node, "getroottree"):
        return base
    try:
        return node.getroottree().getpath(node)
    except Exception:
        return base


def _apply_strategy(strategy: str, value: str, doc: Document, scope,
                    base_locator: str) -> list[Hit]:
    """Run one strategy. Returns an empty list on a clean miss; raises only on bad rules."""
    if strategy in ("css", "css_text", "css_attr"):
        if scope is None:
            return []
        attr = None
        selector = value
        if strategy == "css_attr":
            if "@" not in value:
                raise AdapterError(
                    f"css_attr requires 'SELECTOR@attribute', got {value!r}"
                )
            selector, attr = value.rsplit("@", 1)
        try:
            xpath = _css_to_xpath(selector.strip())
        except Exception as exc:
            raise AdapterError(f"invalid css selector {selector!r}: {exc}") from exc
        nodes = scope.xpath(xpath if xpath.startswith("descendant") else "." + xpath
                            if xpath.startswith("//") else xpath)
        hits = []
        for node in nodes:
            if attr is not None:
                raw = node.get(attr) if hasattr(node, "get") else None
                if raw is None:
                    continue
                text = raw.strip()
            else:
                text = _node_text(node)
            if text:
                hits.append(Hit(text, _node_locator(node, base_locator), text, False, strategy))
        return hits

    if strategy == "xpath":
        if scope is None:
            return []
        try:
            nodes = scope.xpath(value)
        except etree.XPathError as exc:
            raise AdapterError(f"invalid xpath {value!r}: {exc}") from exc
        hits = []
        for node in nodes if isinstance(nodes, list) else [nodes]:
            text = _node_text(node)
            if text:
                hits.append(Hit(text, _node_locator(node, base_locator), text, False, strategy))
        return hits

    if strategy == "regex_on_text":
        haystack = _scope_text(doc, scope)
        try:
            pattern = re.compile(value, re.MULTILINE)
        except re.error as exc:
            raise AdapterError(f"invalid regex {value!r}: {exc}") from exc
        hits = []
        for match in pattern.finditer(haystack):
            captured = match.group(1) if match.groups() else match.group(0)
            if captured and captured.strip():
                hits.append(Hit(captured.strip(), f"{base_locator}#regex",
                                match.group(0).strip(), False, strategy))
        return hits

    if strategy == "pdf_line_regex":
        try:
            pattern = re.compile(value)
        except re.error as exc:
            raise AdapterError(f"invalid pdf_line_regex {value!r}: {exc}") from exc
        # A row scope for a PDF is the matched line itself. Falling back to every line in
        # the document here is what made all three IALA rows report row one's values.
        if isinstance(scope, list):
            lines = scope
        elif isinstance(scope, str):
            lines = [scope]
        else:
            lines = doc.lines
        hits = []
        for index, line in enumerate(lines):
            match = pattern.search(line)
            if not match:
                continue
            captured = match.group(1) if match.groups() else match.group(0)
            if captured and captured.strip():
                hits.append(Hit(captured.strip(), f"{base_locator}#line={index}",
                                line.strip(), False, strategy))
        return hits

    if strategy == "json_pointer":
        resolved = _resolve_scoped_pointer(doc, scope, value)
        if resolved is _MISSING:
            return []
        return [Hit(str(item).strip(), f"{base_locator}{value}", str(item).strip(), False,
                    strategy)
                for item in _iter_scalars(resolved) if str(item).strip()]

    if strategy == "role_text":
        if scope is None:
            return []
        role, _, needle = value.partition("=")
        role = role.strip()
        hits = []
        for node in scope.iter():
            if not hasattr(node, "tag") or not isinstance(node.tag, str):
                continue
            node_role = node.get("role") or _IMPLICIT_ROLES.get(node.tag.lower())
            if node_role != role:
                continue
            text = _node_text(node)
            if not text or (needle and needle.strip().lower() not in text.lower()):
                continue
            hits.append(Hit(text, _node_locator(node, base_locator), text, False, strategy))
        return hits

    raise AdapterError(f"unsupported selector strategy: {strategy!r}")


def _scope_text(doc: Document, scope) -> str:
    if scope is None:
        return doc.text
    if isinstance(scope, list):
        return "\n".join(str(item) for item in scope)
    if hasattr(scope, "text_content"):
        return scope.text_content()
    return str(scope)


_MISSING = object()


def _resolve_scoped_pointer(doc: Document, scope, pointer: str):
    """Resolve against the current scope, then against the document root.

    A row's field pointers are naturally scope-relative ("/organization" within this
    record), while a page-level figure like "/meta/total" lives outside any row. Trying
    scope first and root second lets one rules document express both without inventing a
    relative-pointer syntax that RFC 6901 does not have.
    """
    for target in ([scope] if scope is not None else []) + [doc.data]:
        if target is None:
            continue
        try:
            return resolve_json_pointer(target, pointer)
        except (KeyError, AdapterError):
            continue
    return _MISSING


def resolve_json_pointer(document: Any, pointer: str) -> Any:
    """RFC 6901 pointer resolution. ``-`` selects every element of an array."""
    if pointer in ("", "#"):
        return document
    if not pointer.startswith("/"):
        raise AdapterError(f"json_pointer must start with '/': {pointer!r}")
    current = document
    for token in pointer[1:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            if token == "-":
                return current
            try:
                current = current[int(token)]
            except (ValueError, IndexError) as exc:
                raise KeyError(pointer) from exc
        elif isinstance(current, dict):
            if token not in current:
                raise KeyError(pointer)
            current = current[token]
        else:
            raise KeyError(pointer)
    return current


def _iter_scalars(value: Any) -> Iterable[Any]:
    if isinstance(value, list):
        for item in value:
            yield from _iter_scalars(item)
    elif isinstance(value, dict):
        yield json.dumps(value, sort_keys=True, separators=(",", ":"))
    elif value is not None:
        yield value


def run_selector(selector: dict, doc: Document, scope, base_locator: str) -> list[Hit]:
    """Try primary, then declared fallbacks. Fallback hits are flagged as drift."""
    primary = selector["primary"]
    hits = _apply_strategy(primary["strategy"], primary["value"], doc, scope, base_locator)
    if hits:
        return hits
    for level in ("fallback_1", "fallback_2"):
        alternative = selector.get(level)
        if not alternative:
            continue
        hits = _apply_strategy(alternative["strategy"], alternative["value"], doc, scope,
                               base_locator)
        if hits:
            return [Hit(h.value, h.locator, h.evidence_quote, True, f"{level}:{h.strategy}")
                    for h in hits]
    return []


# -- normalization ---------------------------------------------------------------------

_PHONE_KEEP = re.compile(r"[^\d+]")
_AMOUNT = re.compile(r"(?P<cur>[A-Z]{3}|[£$€])?\s*(?P<num>\d[\d\s.,]*)\s*(?P<cur2>[A-Z]{3}|[£$€])?")
_SYMBOL_TO_ISO = {"£": "GBP", "$": "USD", "€": "EUR"}


def normalize(value: str, mode: Optional[str], *, base_url: Optional[str] = None
              ) -> tuple[Optional[str], str]:
    """Return ``(normalized_value, normalization_state)``.

    A failed normalization never discards the raw value; it records the failure so the row
    reaches review with its evidence intact.
    """
    if mode in (None, "none"):
        return None, "not_requested"
    if mode == "trim":
        return " ".join(value.split()), "normalized"
    if mode == "country_iso2":
        token = value.strip()
        if len(token) == 2 and token.isalpha():
            return token.upper(), "normalized"
        return None, "failed"
    if mode == "phone_e164_or_verbatim":
        cleaned = _PHONE_KEEP.sub("", value)
        if cleaned.startswith("+") and 8 <= len(cleaned) <= 16:
            return cleaned, "normalized"
        digits = cleaned.lstrip("+")
        if 7 <= len(digits) <= 15:
            return digits, "ambiguous"
        return None, "failed"
    if mode == "url_absolute":
        token = value.strip()
        if token.startswith(("http://", "https://")):
            return token, "normalized"
        if base_url and token:
            from urllib.parse import urljoin

            return urljoin(base_url, token), "normalized"
        return None, "failed"
    if mode == "currency_amount":
        match = _AMOUNT.search(value)
        if not match:
            return None, "failed"
        raw_number = match.group("num").replace(" ", "")
        if "," in raw_number and "." in raw_number:
            raw_number = raw_number.replace(",", "") if raw_number.rfind(".") > \
                raw_number.rfind(",") else raw_number.replace(".", "").replace(",", ".")
        elif "," in raw_number:
            parts = raw_number.split(",")
            raw_number = raw_number.replace(",", ".") if len(parts[-1]) == 2 \
                else raw_number.replace(",", "")
        try:
            amount = float(raw_number)
        except ValueError:
            return None, "failed"
        symbol = match.group("cur") or match.group("cur2")
        currency = _SYMBOL_TO_ISO.get(symbol, symbol) if symbol else None
        if currency is None:
            return f"{amount:.2f}", "ambiguous"
        return f"{currency} {amount:.2f}", "normalized"
    raise AdapterError(f"unsupported normalize mode: {mode!r}")


# -- the interpreter --------------------------------------------------------------------


def load_rules(path_or_mapping, *, validate: bool = True, schema_path=None) -> dict:
    if isinstance(path_or_mapping, dict):
        rules = path_or_mapping
    else:
        from pathlib import Path

        rules = json.loads(Path(path_or_mapping).read_text(encoding="utf-8"))
    if validate:
        from pathlib import Path

        from jsonschema import Draft202012Validator, FormatChecker

        from .resources import adapter_rules_schema_path

        schema_path = schema_path or adapter_rules_schema_path()
        schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(rules)
    if rules.get("output_contract_version") != OUTPUT_CONTRACT_VERSION:
        raise AdapterError(
            f"adapter output_contract_version must be {OUTPUT_CONTRACT_VERSION!r}"
        )
    return rules


def parse_document(rules: dict, doc: Document, *, base_locator: str = "",
                   base_url: Optional[str] = None,
                   key_fn: Optional[Callable[[ParsedRecord], str]] = None,
                   row_offset: int = 0) -> ParseOutcome:
    """Parse one artifact into records. Multi-page routes call this per page."""
    list_rules = rules["list"]
    drift_detail: list[str] = []
    rejects: list[str] = []

    container_hits = _select_nodes(list_rules["container"], doc, base_locator, explode=False)
    container_resolved = bool(container_hits.nodes)
    if container_hits.used_fallback:
        drift_detail.append("container matched only via fallback selector")

    scope = container_hits.nodes[0] if container_hits.nodes else None
    row_result = _select_nodes(list_rules["row"], doc, base_locator, scope=scope)
    if row_result.used_fallback:
        drift_detail.append("row matched only via fallback selector")

    records: list[ParsedRecord] = []
    for index, row_node in enumerate(row_result.nodes):
        record = ParsedRecord(
            source_record_key="", row_ordinal=row_offset + index,
            record_locator=_node_locator(row_node, f"{base_locator}#row={index}"),
        )
        rejected = False
        for reject in rules.get("rejects", []):
            if _reject_matches(reject["when"], doc, row_node):
                rejects.append(f"row {row_offset + index}: {reject['parse_state']}")
                rejected = True
                break
        if rejected:
            continue

        for field_name, spec in rules["fields"].items():
            field_scope = doc.lines if spec.get("scope") == "page" and doc.lines else (
                None if spec.get("scope") == "page" else row_node
            )
            if spec.get("scope") == "page" and not doc.lines:
                field_scope = doc.tree if doc.tree is not None else None
            hits = run_selector(spec["selector"], doc, field_scope, record.record_locator)
            if not hits:
                if spec.get("required"):
                    # "required" is a row-level precondition: a row without it is not a
                    # usable record. Dropping it here keeps it out of extracted_count and
                    # into the declared-drop list, where the count reconciliation sees it.
                    rejects.append(f"row {row_offset + index}: missing required {field_name}")
                    rejected = True
                    break
                continue
            if spec.get("cardinality", "one") == "one":
                hits = hits[:1]
            if any(hit.used_fallback for hit in hits):
                drift_detail.append(f"field {field_name} matched only via fallback selector")
            mode = spec.get("normalize")
            normalized_hits = []
            for hit in hits:
                value, state = normalize(hit.value, mode, base_url=base_url)
                normalized_hits.append(Hit(hit.value, hit.locator, hit.evidence_quote,
                                           hit.used_fallback, hit.strategy, value, state))
            record.fields[field_name] = normalized_hits
        if rejected:
            continue
        if record.fields:
            record.source_record_key = (key_fn or _default_key)(record)
            records.append(record)

    # structural_count counts rows, so it belongs inside the container. published_count is
    # the figure the PAGE states, which usually sits outside the list it describes.
    structural_count = _count_from(list_rules.get("structural_count"), doc, scope, base_locator)
    published_count = _count_from(list_rules.get("published_count"), doc,
                                  doc.tree if doc.tree is not None else None, base_locator)

    minimum = list_rules.get("min_expected_rows")
    if minimum is not None and len(records) < minimum and not (
        len(records) == 0 and list_rules.get("empty_is_valid")
    ):
        drift_detail.append(f"extracted {len(records)} rows, below min_expected_rows {minimum}")

    return ParseOutcome(
        records=records, structural_count=structural_count, published_count=published_count,
        container_resolved=container_resolved, drift=bool(drift_detail),
        drift_detail=drift_detail, rejects=rejects,
        empty_is_valid=bool(list_rules.get("empty_is_valid")),
    )


@dataclass
class _NodeResult:
    nodes: list
    used_fallback: bool


def _select_nodes(selector: dict, doc: Document, base_locator: str, scope=None,
                  explode: bool = True) -> _NodeResult:
    """Selector resolution that yields nodes rather than text, for container/row.

    ``explode`` distinguishes "the container" from "the rows inside it". For HTML both are
    element lists and it makes no difference, but for JSON a container pointer resolves to
    an array that must stay one node — exploding it made the container the first record and
    every row selector miss.
    """
    for level, spec in _selector_levels(selector):
        nodes = _nodes_for(spec, doc, scope, explode=explode)
        if nodes:
            return _NodeResult(nodes, level != "primary")
    return _NodeResult([], False)


def _selector_levels(selector: dict):
    yield "primary", selector["primary"]
    for level in ("fallback_1", "fallback_2"):
        if selector.get(level):
            yield level, selector[level]


def _nodes_for(spec: dict, doc: Document, scope, explode: bool = True) -> list:
    strategy, value = spec["strategy"], spec["value"]
    if strategy in ("css", "css_text"):
        root = scope if scope is not None else doc.tree
        if root is None:
            return []
        try:
            xpath = _css_to_xpath(value.strip())
        except Exception as exc:
            raise AdapterError(f"invalid css selector {value!r}: {exc}") from exc
        return list(root.xpath(xpath if not xpath.startswith("//") else "." + xpath))
    if strategy == "xpath":
        root = scope if scope is not None else doc.tree
        if root is None:
            return []
        result = root.xpath(value)
        return list(result) if isinstance(result, list) else [result]
    if strategy == "json_pointer":
        resolved = _resolve_scoped_pointer(doc, scope, value)
        if resolved is _MISSING:
            return []
        if explode and isinstance(resolved, list):
            return list(resolved)
        return [resolved]
    if strategy == "pdf_line_regex":
        pattern = re.compile(value)
        return [line for line in doc.lines if pattern.search(line)]
    if strategy == "regex_on_text":
        pattern = re.compile(value, re.MULTILINE)
        return [m.group(0) for m in pattern.finditer(_scope_text(doc, scope))]
    if strategy == "role_text":
        root = scope if scope is not None else doc.tree
        if root is None:
            return []
        role, _, needle = value.partition("=")
        matched = []
        for node in root.iter():
            if not isinstance(getattr(node, "tag", None), str):
                continue
            node_role = node.get("role") or _IMPLICIT_ROLES.get(node.tag.lower())
            if node_role == role.strip():
                text = _node_text(node)
                if not needle or needle.strip().lower() in text.lower():
                    matched.append(node)
        return matched
    raise AdapterError(f"unsupported selector strategy for node selection: {strategy!r}")


#: Strategies that select elements. Counting these means counting nodes; the other
#: strategies select text, where a count means "read the number the page states".
_NODE_STRATEGIES = frozenset({"css", "xpath", "role_text", "json_pointer"})


def _count_from(selector: Optional[dict], doc: Document, scope, base_locator: str
                ) -> Optional[int]:
    """Measure a count the way the selector's own strategy implies.

    ``css: tr.provider`` means "how many rows are there" — count the nodes. ``css_text:
    p.total`` means "what number does the page publish" — parse it out of the text. Guessing
    from the value is how a phone number in row one becomes a structural count of 37 billion.

    Strategy alone is not always enough: a json_pointer or pdf_line_regex does both jobs
    ("/-" counts records, "/meta/total" states one), so a count selector may declare
    ``count_mode`` explicitly. The strategy heuristic is only the default.
    """
    if not selector:
        return None
    mode = selector.get("count_mode")
    strategy = selector["primary"]["strategy"]
    if mode is None:
        mode = "nodes" if strategy in _NODE_STRATEGIES else "value"
    if mode == "nodes":
        nodes = _select_nodes(selector, doc, base_locator, scope=scope)
        return len(nodes.nodes) if nodes.nodes or scope is not None else None
    for hit in run_selector(selector, doc, scope, base_locator):
        match = re.search(r"\d[\d\s,.]*", hit.value)
        if match:
            digits = re.sub(r"[^\d]", "", match.group(0))
            if digits:
                return int(digits)
    return None


def _reject_matches(expression: str, doc: Document, row_node) -> bool:
    """``when`` is a regex tested against the row's text."""
    try:
        pattern = re.compile(expression, re.IGNORECASE)
    except re.error as exc:
        raise AdapterError(f"invalid reject expression {expression!r}: {exc}") from exc
    return bool(pattern.search(_node_text(row_node) if row_node is not None else doc.text))


def _default_key(record: ParsedRecord) -> str:
    name = record.fields.get("published_name")
    provider = record.fields.get("provider_id")
    if provider:
        return f"provider:{provider[0].value}"
    if name:
        return f"name:{name[0].value}|row:{record.row_ordinal}"
    return f"row:{record.row_ordinal}"


def merge_outcomes(outcomes: Sequence[ParseOutcome]) -> ParseOutcome:
    """Combine per-page outcomes for a paginated route into one parse result."""
    if not outcomes:
        raise AdapterError("at least one page outcome is required")
    records: list[ParsedRecord] = []
    for outcome in outcomes:
        records.extend(outcome.records)
    structural = [o.structural_count for o in outcomes if o.structural_count is not None]
    published = [o.published_count for o in outcomes if o.published_count is not None]
    return ParseOutcome(
        records=records,
        structural_count=sum(structural) if structural else None,
        published_count=max(published) if published else None,
        container_resolved=all(o.container_resolved for o in outcomes),
        drift=any(o.drift for o in outcomes),
        drift_detail=[d for o in outcomes for d in o.drift_detail],
        rejects=[r for o in outcomes for r in o.rejects],
        empty_is_valid=outcomes[0].empty_is_valid,
    )
