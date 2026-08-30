"""Structured-data extraction (T2-01): JSON-LD, microdata, RDFa-lite and OpenGraph.

Tier 2 reads ~1,200 unknown training-centre websites, so per-site selectors are not an
option. Structured data is the one generic signal that is *published deliberately* rather
than inferred: when a site emits schema.org ``Course`` with an ``Offer``, the price it
states is the price it means. That makes this the highest-precision extractor available and
the first one tier 2 should try.

Design rules this module holds to:

* **Never raise.** Real-world markup is broken in creative ways — trailing commas in
  JSON-LD, ``@graph`` nested five deep, microdata with no ``itemtype``, HTML entities inside
  script tags. Every parse failure degrades to fewer findings, never to an exception. The
  caller is a batch job over a thousand hostile documents.
* **Every value carries its evidence.** A finding without a locator and a verbatim quote is
  not usable downstream, because tier-2 output is review-only and a human has to be able to
  see what the page actually said.
* **Bounded.** Documents, node counts and recursion depth are capped, so a 50MB page or a
  self-referential ``@graph`` cannot hang a worker.
* **No inference.** This module reports what the markup asserts. Deciding whether an
  asserted price is credible belongs to scoring (T2-07), not here.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable, Iterator, Optional

MAX_JSON_LD_BYTES = 2 * 1024 * 1024
MAX_GRAPH_DEPTH = 12
MAX_NODES = 20_000
MAX_FINDINGS = 2_000
MAX_QUOTE = 400

#: schema.org types tier 2 cares about, lowercased for comparison.
COURSE_TYPES = frozenset({
    "course", "courseinstance", "educationaloccupationalprogram",
    "event", "educationevent", "learningresource",
})
ORG_TYPES = frozenset({"organization", "localbusiness", "educationalorganization",
                       "school", "collegeoruniversity", "corporation", "place",
                       "professionalservice", "trainingorganization"})
OFFER_TYPES = frozenset({
    "offer", "aggregateoffer", "pricespecification",
    "unitpricespecification", "compoundpricespecification",
})


@dataclass(frozen=True)
class Finding:
    """One asserted fact, with enough provenance to be reviewed."""

    field: str            # published_name | price_text | certificate_name | ...
    value: str
    source: str           # json_ld | microdata | rdfa | opengraph
    locator: str
    quote: str
    subject_type: str = ""
    subject_name: str = ""
    extra: dict = field(default_factory=dict)


def _clip(text: str, limit: int = MAX_QUOTE) -> str:
    text = " ".join(str(text).split())
    return text[:limit]


def _as_list(value: Any) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _type_names(node: Any) -> list[str]:
    if not isinstance(node, dict):
        return []
    names = []
    for raw in _as_list(node.get("@type")) + _as_list(node.get("type")):
        if isinstance(raw, str):
            names.append(raw.rsplit("/", 1)[-1].rsplit("#", 1)[-1].strip().lower())
    return names


def _text_of(value: Any) -> Optional[str]:
    """Reduce a schema.org value to a string without inventing one."""
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, dict):
        for key in ("@value", "name", "text", "value"):
            nested = value.get(key)
            if isinstance(nested, (str, int, float)):
                text = str(nested).strip()
                if text:
                    return text
    return None


# -- JSON-LD ---------------------------------------------------------------------------

_TRAILING_COMMA = re.compile(r",\s*([}\]])")
_JS_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_CDATA = re.compile(r"^\s*(?://)?\s*<!\[CDATA\[(.*?)\]\]>\s*$", re.DOTALL)


def parse_json_ld_text(raw: str) -> list[Any]:
    """Parse one ``<script type="application/ld+json">`` body as leniently as is safe.

    Real sites ship JSON-LD with CDATA wrappers, JS comments and trailing commas. Repairing
    those recovers genuine data. Repair stops well short of guessing at meaning: if it still
    will not parse, the block is dropped rather than salvaged by regex.
    """
    if not raw or len(raw.encode("utf-8", errors="ignore")) > MAX_JSON_LD_BYTES:
        return []
    text = raw.strip()
    match = _CDATA.match(text)
    if match:
        text = match.group(1).strip()
    for attempt in (text, _TRAILING_COMMA.sub(r"\1", _JS_COMMENT.sub("", text))):
        try:
            parsed = json.loads(attempt)
        except (ValueError, RecursionError):
            continue
        return parsed if isinstance(parsed, list) else [parsed]
    return []


def iter_json_ld_nodes(document: Any, *, depth: int = 0,
                       seen: Optional[set[int]] = None) -> Iterator[dict]:
    """Walk a JSON-LD document, flattening ``@graph`` and nested objects.

    Cycle- and depth-guarded: ``@graph`` structures in the wild do self-reference, and an
    unguarded walk on a thousand-site corpus will eventually meet one.
    """
    if depth > MAX_GRAPH_DEPTH:
        return
    seen = seen if seen is not None else set()
    identity = id(document)
    if identity in seen:
        return
    if isinstance(document, dict):
        seen.add(identity)
        yield document
        for key, value in document.items():
            if key in ("@context",):
                continue
            if isinstance(value, (dict, list)):
                yield from iter_json_ld_nodes(value, depth=depth + 1, seen=seen)
    elif isinstance(document, list):
        seen.add(identity)
        for item in document[:MAX_NODES]:
            if isinstance(item, (dict, list)):
                yield from iter_json_ld_nodes(item, depth=depth + 1, seen=seen)


def _offer_findings(node: dict, locator: str, subject_type: str,
                    subject_name: str, *, depth: int = 0) -> list[Finding]:
    """Pull price facts out of an Offer / AggregateOffer / PriceSpecification."""
    findings: list[Finding] = []
    currency = None
    for key in ("priceCurrency", "currency"):
        currency = currency or _text_of(node.get(key))

    price_keys = ("price", "lowPrice", "highPrice", "minPrice", "maxPrice")
    for key in price_keys:
        if key not in node:
            continue
        value = _text_of(node.get(key))
        if value is None:
            continue
        quote = f"{key}: {value}" + (f" {currency}" if currency else "")
        findings.append(Finding(
            field="price_text", value=(f"{currency} {value}" if currency else value).strip(),
            source="json_ld", locator=f"{locator}/{key}", quote=_clip(quote),
            subject_type=subject_type, subject_name=subject_name,
            extra={"currency": currency, "amount_text": value, "price_role": key},
        ))

    for nested_key in ("priceSpecification", "offers", "priceComponent"):
        for index, child in enumerate(_as_list(node.get(nested_key))):
            if isinstance(child, dict) and depth < MAX_GRAPH_DEPTH:
                findings.extend(_offer_findings(
                    child, f"{locator}/{nested_key}[{index}]", subject_type, subject_name,
                    depth=depth + 1,
                ))
    return findings[:MAX_FINDINGS]


def extract_json_ld(blocks: Iterable[tuple[str, str]]) -> list[Finding]:
    """``blocks`` is an iterable of ``(locator, raw_script_text)``."""
    findings: list[Finding] = []
    for locator, raw in blocks:
        for document in parse_json_ld_text(raw):
            for index, node in enumerate(iter_json_ld_nodes(document)):
                if len(findings) >= MAX_FINDINGS:
                    return findings
                findings.extend(_node_findings(node, f"{locator}#{index}"))
    return findings


def _node_findings(node: dict, locator: str) -> list[Finding]:
    types = _type_names(node)
    if not types:
        return []
    findings: list[Finding] = []
    name = _text_of(node.get("name")) or ""
    is_course = any(t in COURSE_TYPES for t in types)
    is_org = any(t in ORG_TYPES for t in types)
    is_offer = any(t in OFFER_TYPES for t in types)
    subject_type = types[0]

    if is_course and name:
        findings.append(Finding("certificate_name", name, "json_ld", f"{locator}/name",
                                _clip(f"name: {name}"), subject_type, name))
    if is_org and name:
        findings.append(Finding("published_name", name, "json_ld", f"{locator}/name",
                                _clip(f"name: {name}"), subject_type, name))

    if is_org or is_course:
        telephone = _text_of(node.get("telephone"))
        if telephone:
            findings.append(Finding("published_phone", telephone, "json_ld",
                                    f"{locator}/telephone", _clip(f"telephone: {telephone}"),
                                    subject_type, name))
        website = _text_of(node.get("url"))
        if website:
            findings.append(Finding("published_website", website, "json_ld",
                                    f"{locator}/url", _clip(f"url: {website}"),
                                    subject_type, name))
        for address in _as_list(node.get("address")):
            findings.extend(_address_findings(address, f"{locator}/address",
                                              subject_type, name))
        description = _text_of(node.get("description"))
        if description and is_course:
            findings.append(Finding("package_contents", description, "json_ld",
                                    f"{locator}/description",
                                    _clip(description), subject_type, name))

    if is_offer:
        findings.extend(_offer_findings(node, locator, subject_type, name))
    else:
        for key in ("offers", "priceSpecification"):
            for index, child in enumerate(_as_list(node.get(key))):
                if isinstance(child, dict):
                    findings.extend(_offer_findings(child, f"{locator}/{key}[{index}]",
                                                    subject_type, name))
    return findings


def _address_findings(address: Any, locator: str, subject_type: str,
                      subject_name: str) -> list[Finding]:
    if isinstance(address, str):
        return [Finding("published_address", address.strip(), "json_ld", locator,
                        _clip(address), subject_type, subject_name)] if address.strip() else []
    if not isinstance(address, dict):
        return []
    findings = []
    street = _text_of(address.get("streetAddress"))
    locality = _text_of(address.get("addressLocality"))
    country = _text_of(address.get("addressCountry")) or _text_of(
        (address.get("addressCountry") or {}).get("name")
        if isinstance(address.get("addressCountry"), dict) else None
    )
    postal = _text_of(address.get("postalCode"))
    joined = ", ".join(part for part in (street, postal, locality) if part)
    if joined:
        findings.append(Finding("published_address", joined, "json_ld",
                                f"{locator}/streetAddress", _clip(joined),
                                subject_type, subject_name))
    if locality:
        findings.append(Finding("published_locality", locality, "json_ld",
                                f"{locator}/addressLocality", _clip(locality),
                                subject_type, subject_name))
    if country:
        findings.append(Finding("published_country", country, "json_ld",
                                f"{locator}/addressCountry", _clip(country),
                                subject_type, subject_name))
    return findings


# -- microdata / RDFa / OpenGraph -------------------------------------------------------

_ITEMPROP_FIELD = {
    "name": "published_name",
    "telephone": "published_phone",
    "url": "published_website",
    "streetaddress": "published_address",
    "addresslocality": "published_locality",
    "addresscountry": "published_country",
    "price": "price_text",
    "lowprice": "price_text",
    "pricecurrency": None,   # captured as context, not as its own finding
}


def _subject_type_of(node) -> str:
    """The itemtype of the nearest enclosing itemscope, lowercased."""
    scope = node
    for _ in range(MAX_GRAPH_DEPTH):
        if scope is None:
            break
        itemtype = scope.get("itemtype") if hasattr(scope, "get") else None
        if itemtype:
            return itemtype.rsplit("/", 1)[-1].rsplit("#", 1)[-1].strip().lower()
        scope = scope.getparent()
    return ""


def _field_for(prop: str, subject_type: str):
    """Map an itemprop to a field, using the enclosing type for context.

    ``name`` means different things depending on what it names: inside a Course it is the
    course title, inside an Organization it is the centre. A context-free mapping files
    every course under published_name and loses the course list entirely.
    """
    prop = prop.strip().lower()
    if prop == "name":
        # In this domain an Offer names the thing being sold, which is a course. Treating
        # it as an organisation name would both mislabel it and lose the course.
        if subject_type in COURSE_TYPES or subject_type in OFFER_TYPES:
            return "certificate_name"
        if subject_type in ORG_TYPES or not subject_type:
            return "published_name"
        return None
    if prop == "description" and subject_type in COURSE_TYPES:
        return "package_contents"
    return _ITEMPROP_FIELD.get(prop, False)


def _element_locator(node) -> str:
    try:
        return node.getroottree().getpath(node)
    except Exception:
        return "?"


def _element_value(node, prop: str) -> Optional[str]:
    """Microdata value precedence, per the HTML microdata rules."""
    tag = (node.tag if isinstance(node.tag, str) else "").lower()
    for attribute in ("content", "datetime", "value"):
        raw = node.get(attribute)
        if raw and raw.strip():
            return raw.strip()
    if tag in ("a", "link", "area") and node.get("href"):
        return node.get("href").strip()
    if tag in ("img", "audio", "video", "source", "iframe") and node.get("src"):
        return node.get("src").strip()
    if tag == "meta":
        return None
    text = " ".join(node.text_content().split())
    return text or None


def extract_microdata(tree) -> list[Finding]:
    """Pull itemprop values out of an lxml tree. Never raises on odd markup."""
    findings: list[Finding] = []
    if tree is None:
        return findings
    try:
        nodes = tree.xpath("//*[@itemprop]")
    except Exception:
        return findings
    for node in nodes[:MAX_NODES]:
        if len(findings) >= MAX_FINDINGS:
            break
        try:
            subject_type = _subject_type_of(node)
            for prop in (node.get("itemprop") or "").split():
                field_name = _field_for(prop, subject_type)
                if field_name in (None, False):
                    continue
                value = _element_value(node, prop)
                if not value:
                    continue
                findings.append(Finding(
                    field_name, value, "microdata", _element_locator(node),
                    _clip(value), subject_type,
                ))
        except Exception:
            continue
    return findings


_OG_FIELD = {
    "og:title": "published_name",
    "og:url": "published_website",
    "og:site_name": "published_name",
    "product:price:amount": "price_text",
    "og:street-address": "published_address",
    "og:locality": "published_locality",
    "og:country-name": "published_country",
    "og:phone_number": "published_phone",
}


def extract_opengraph(tree) -> list[Finding]:
    """OpenGraph/product meta tags. Weak evidence, but present on many commerce pages."""
    findings: list[Finding] = []
    if tree is None:
        return findings
    try:
        metas = tree.xpath("//meta[@property or @name]")
    except Exception:
        return findings
    currency = None
    for node in metas[:MAX_NODES]:
        key = (node.get("property") or node.get("name") or "").strip().lower()
        if key == "product:price:currency":
            currency = (node.get("content") or "").strip() or None
    for node in metas[:MAX_NODES]:
        key = (node.get("property") or node.get("name") or "").strip().lower()
        field_name = _OG_FIELD.get(key)
        if not field_name:
            continue
        value = (node.get("content") or "").strip()
        if not value:
            continue
        if field_name == "price_text" and currency:
            value = f"{currency} {value}"
        findings.append(Finding(field_name, value, "opengraph", _element_locator(node),
                                _clip(f"{key}: {value}")))
    return findings


def extract_rdfa(tree) -> list[Finding]:
    """RDFa-lite: ``property=`` attributes carrying schema.org terms."""
    findings: list[Finding] = []
    if tree is None:
        return findings
    try:
        nodes = tree.xpath("//*[@property and not(@itemprop)]")
    except Exception:
        return findings
    for node in nodes[:MAX_NODES]:
        term = (node.get("property") or "").rsplit(":", 1)[-1].strip().lower()
        subject_type = _subject_type_of(node)
        field_name = _field_for(term, subject_type)
        if field_name in (None, False):
            continue
        value = (node.get("content") or "").strip() or _element_value(node, term)
        if not value:
            continue
        findings.append(Finding(field_name, value, "rdfa", _element_locator(node),
                                _clip(value), subject_type))
    return findings


# -- entry point ------------------------------------------------------------------------


def extract_structured(tree) -> list[Finding]:
    """Run every structured-data extractor over one parsed HTML tree.

    Order is precision-first: JSON-LD, then microdata, then RDFa, then OpenGraph. Callers
    that need one value per field should prefer earlier sources; conflict resolution across
    sources belongs to scoring (T2-07), which is why nothing is deduplicated here.
    """
    if tree is None:
        return []
    blocks: list[tuple[str, str]] = []
    try:
        for node in tree.xpath(
            "//script[@type='application/ld+json' or @type='application/json+ld']"
        )[:200]:
            raw = node.text_content()
            if raw and raw.strip():
                blocks.append((_element_locator(node), raw))
    except Exception:
        blocks = []

    findings: list[Finding] = []
    for extractor in (lambda: extract_json_ld(blocks),
                      lambda: extract_microdata(tree),
                      lambda: extract_rdfa(tree),
                      lambda: extract_opengraph(tree)):
        try:
            findings.extend(extractor())
        except Exception:
            # A malformed document must cost us that extractor's findings, never the run.
            continue
        if len(findings) >= MAX_FINDINGS:
            break
    return findings[:MAX_FINDINGS]
