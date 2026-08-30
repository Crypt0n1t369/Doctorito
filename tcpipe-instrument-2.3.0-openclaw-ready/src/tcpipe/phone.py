"""Phone parsing (T2-03): E.164 normalization with country context.

The formatting is the easy half. The hard half is *precision*: a training-centre page is
full of digit strings that are not phone numbers — dates, postcodes, VAT and registration
numbers, course codes, prices, opening hours, years. Emitting one of those as a contact
number is worse than emitting nothing, because a wrong number in a contact export gets
dialled.

So this module is deliberately reluctant. It rejects on structure before it ever tries to
normalize, and when it cannot establish a country it says so rather than assuming one — an
eight-digit national number is +371… in Riga and +372… in Tallinn, and the two are
different businesses.

Confidence:

* ``certain``  — an international number (`+371…`, `00371…`) whose national length is valid
  for the country its own prefix names.
* ``probable`` — a national number resolved through a supplied country hint.
* ``ambiguous`` — plausibly a phone number, but no country could be established, so no
  E.164 form exists.

Never raises, bounded, deterministic.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

MAX_INPUT = 200_000
MAX_RESULTS = 30
E164_MAX_DIGITS = 15

#: ISO 3166-1 alpha-2 -> E.164 calling code.
CALLING_CODES = {
    "LV": "371", "EE": "372", "LT": "370", "FI": "358", "SE": "46", "NO": "47",
    "DK": "45", "IS": "354", "DE": "49", "AT": "43", "CH": "41", "NL": "31",
    "BE": "32", "FR": "33", "ES": "34", "IT": "39", "PT": "351", "IE": "353",
    "GB": "44", "PL": "48", "CZ": "420", "SK": "421", "HU": "36", "RO": "40",
    "BG": "359", "GR": "30", "HR": "385", "SI": "386", "RS": "381", "TR": "90",
    "UA": "380", "RU": "7", "US": "1", "CA": "1", "AU": "61", "NZ": "64",
    "IN": "91", "ZA": "27", "SG": "65", "HK": "852", "AE": "971", "SA": "966",
    "BR": "55", "MX": "52", "JP": "81", "KR": "82", "CN": "86", "MY": "60",
    "TH": "66", "PH": "63", "ID": "62", "LU": "352", "MT": "356", "CY": "357",
}

#: Valid national significant number lengths (after any trunk prefix is removed).
NSN_LENGTHS = {
    "LV": (8, 8), "EE": (7, 8), "LT": (8, 8), "FI": (5, 12), "SE": (7, 13),
    "NO": (8, 8), "DK": (8, 8), "IS": (7, 7), "DE": (6, 11), "AT": (4, 13),
    "CH": (9, 9), "NL": (9, 9), "BE": (8, 9), "FR": (9, 9), "IT": (6, 11),
    "ES": (9, 9), "PT": (9, 9), "IE": (7, 9), "GB": (9, 10), "PL": (9, 9),
    "CZ": (9, 9), "SK": (9, 9), "HU": (8, 9), "RO": (9, 9), "BG": (8, 9),
    "GR": (10, 10), "HR": (8, 9), "SI": (8, 8), "RS": (8, 9), "TR": (10, 10),
    "UA": (9, 9), "RU": (10, 10), "US": (10, 10), "CA": (10, 10), "AU": (9, 9),
    "NZ": (8, 10), "IN": (10, 10), "ZA": (9, 9), "SG": (8, 8), "HK": (8, 8),
    "AE": (8, 9), "SA": (9, 9), "BR": (10, 11), "MX": (10, 10), "JP": (9, 10),
    "KR": (9, 10), "CN": (11, 11), "LU": (6, 9), "MT": (8, 8), "CY": (8, 8),
}

#: Calling codes shared by several countries — the code alone cannot name a country.
SHARED_CALLING_CODES = {"1": ("US", "CA"), "7": ("RU", "KZ")}

#: Italy keeps the leading zero of a landline number; most of Europe strips it.
KEEPS_LEADING_ZERO = frozenset({"IT"})

_CODES_BY_LENGTH = sorted(
    {code for code in CALLING_CODES.values()}, key=lambda c: (-len(c), c)
)
_COUNTRY_BY_CODE: dict[str, list[str]] = {}
for _iso, _code in sorted(CALLING_CODES.items()):
    _COUNTRY_BY_CODE.setdefault(_code, []).append(_iso)

EXTENSION = re.compile(
    r"(?:"
    r"\b(?:ext|extn|extension|kl|int|durchwahl|toestel|anexo|ramal)\b\.?\s*"
    r"|(?<![a-z0-9])x\.?\s*"          # "x99" — no word boundary follows an x before a digit
    r"|#\s*"
    r")(\d{1,6})\b",
    re.IGNORECASE,
)

#: A candidate run of digits and phone punctuation. Requires at least six digits, so a
#: house number or a group size never reaches the parser.
CANDIDATE = re.compile(
    r"(?:(?:\+|00)\s?)?(?:\(\s*\+?\d{1,4}\s*\)|\d)[\d\s\-(). /]{4,25}\d"
)


@dataclass(frozen=True)
class Phone:
    """One parsed contact number, with the doubt that produced it."""

    raw: str
    digits: str
    e164: Optional[str] = None
    country: Optional[str] = None
    national: Optional[str] = None
    extension: Optional[str] = None
    confidence: str = "ambiguous"
    notes: tuple[str, ...] = ()
    start: int = 0
    end: int = 0

    @property
    def normalized(self) -> str:
        """What goes in ``field_observation.normalized_value``.

        Falls back to the digit string when no country could be established, so the
        evidence survives even when E.164 does not.
        """
        if self.e164 and self.extension:
            return f"{self.e164};ext={self.extension}"
        return self.e164 or self.digits

    def as_dict(self) -> dict:
        return {"e164": self.e164, "country": self.country, "national": self.national,
                "extension": self.extension, "confidence": self.confidence,
                "notes": list(self.notes), "raw": self.raw}


# -- rejection --------------------------------------------------------------------------

#: Dates are matched against the WHOLE candidate, with real calendar bounds. Searching
#: inside it rejected the French phone format 06.12.34.56.78, whose first three groups
#: happen to look like a date — a date has exactly three components, that has five.
_DATE_ISO = re.compile(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})")
_DATE_DMY = re.compile(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})")


def _is_calendar_date(text: str) -> bool:
    match = _DATE_ISO.fullmatch(text)
    if match:
        year, month, day = (int(g) for g in match.groups())
        return 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31
    match = _DATE_DMY.fullmatch(text)
    if match:
        day, month, year = (int(g) for g in match.groups())
        if len(match.group(3)) == 2:
            year += 2000
        return 1900 <= year <= 2100 and 1 <= month <= 12 and 1 <= day <= 31
    return False
_TIME_PATTERN = re.compile(r"\b\d{1,2}[:.]\d{2}\s*[-–—]\s*\d{1,2}[:.]\d{2}\b")
_POSTCODE_PATTERN = re.compile(r"\b[A-Z]{2}\s?-\s?\d{4,6}\b")   # LV-1010
_VAT_PATTERN = re.compile(r"\b[A-Z]{2}\s?\d{8,12}\b")           # LV40003123456
_MONEY_ADJACENT = re.compile(r"[€£$¥₺₽]|\b(?:EUR|GBP|USD|SEK|NOK|DKK|PLN|CZK)\b", re.I)
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b")


def _overlaps(candidate: str, context: str, pattern: re.Pattern) -> bool:
    """True when the candidate sits inside a span the pattern matched in the context."""
    if not context:
        return False
    position = context.find(candidate)
    if position < 0:
        # Cannot locate it; fall back to testing the candidate in isolation.
        return bool(pattern.search(candidate))
    start, end = position, position + len(candidate)
    for match in pattern.finditer(context):
        if match.start() < end and start < match.end():
            return True
    return False


def rejection_reason(raw: str, context: str = "") -> Optional[str]:
    """Why this digit string is not a phone number, or None if it might be.

    Structural rejection happens before normalization, because a date that survives to the
    normalizer will emerge as a confident, well-formatted, wrong phone number.
    """
    if not raw or not raw.strip():
        return "empty"
    text = raw.strip()

    if _is_calendar_date(text):
        return "looks_like_a_date"
    if _TIME_PATTERN.search(text) or _TIME_PATTERN.search(context):
        return "looks_like_opening_hours"
    # These must test whether the CANDIDATE is part of a postcode or identifier, not
    # whether one appears nearby. A contact block always contains both an address and a
    # phone number, so a proximity test rejects every real number on the page.
    if _overlaps(text, context, _POSTCODE_PATTERN):
        return "looks_like_a_postcode"
    if _overlaps(text, context, _VAT_PATTERN) or _overlaps(text, context, _IBAN):
        return "looks_like_a_vat_or_bank_identifier"

    digits = re.sub(r"\D", "", text)
    if len(digits) < 6:
        return "too_few_digits"
    if len(digits) > E164_MAX_DIGITS + 6:      # allow room for an extension
        return "too_many_digits"
    if re.fullmatch(r"(?:19|20)\d{2}", text.strip()):
        return "looks_like_a_year"
    if len(set(digits)) == 1:
        return "placeholder_repeated_digit"
    if _MONEY_ADJACENT.search(context) and not re.search(r"[+()]|\btel\b|\bphone\b", context, re.I):
        return "adjacent_to_a_currency"
    # A price ends in exactly two decimals. So does a French phone number written
    # 06.12.34.56.78, so require thousands-shaped groups and a price-sized magnitude:
    # the French form has 2-digit groups and ten digits, and fails both.
    if (re.fullmatch(r"\d{1,7}(?:[  ,.]\d{3})*[.,]\d{2}", text.strip())
            and len(digits) <= 9):
        return "looks_like_a_price"
    return None


# -- parsing ----------------------------------------------------------------------------


def _split_extension(text: str) -> tuple[str, Optional[str]]:
    match = EXTENSION.search(text)
    if not match:
        return text, None
    return (text[:match.start()] + text[match.end():]).strip(), match.group(1)


def _country_for_code(code: str, hint: Optional[str]) -> tuple[Optional[str], tuple[str, ...]]:
    countries = _COUNTRY_BY_CODE.get(code, [])
    if code in SHARED_CALLING_CODES:
        candidates = SHARED_CALLING_CODES[code]
        if hint and hint.upper() in candidates:
            return hint.upper(), ()
        return None, (f"calling code +{code} is shared by {list(candidates)}",)
    if len(countries) == 1:
        return countries[0], ()
    if hint and hint.upper() in countries:
        return hint.upper(), ()
    return (countries[0], ()) if countries else (None, ())


def _valid_nsn(country: Optional[str], nsn: str) -> bool:
    if country is None:
        return 4 <= len(nsn) <= 14
    low, high = NSN_LENGTHS.get(country, (4, 14))
    return low <= len(nsn) <= high


def parse_phone(raw: str, *, country_hint: Optional[str] = None,
                context: str = "") -> Optional[Phone]:
    """Parse one candidate into a ``Phone``, or return None if it is not one."""
    if not raw:
        return None
    reason = rejection_reason(raw, context or raw)
    if reason:
        return None

    body, extension = _split_extension(raw)
    notes: list[str] = []

    # "+44 (0) 1224 555010" — a trunk zero in brackets inside an international number is
    # common in the UK and Germany and must be dropped, not kept.
    bracketed_trunk = re.search(r"\(\s*0\s*\)", body)
    if bracketed_trunk:
        body = body[:bracketed_trunk.start()] + body[bracketed_trunk.end():]
        notes.append("dropped_bracketed_trunk_prefix")

    # "(+371) 6700 1234" — brackets around the country code are common and must not
    # hide the "+", or the number silently degrades to an un-normalizable national one.
    stripped = re.sub(r"^\s*\(\s*(\+?\d{1,4})\s*\)", r"\1", body.strip()).strip()
    if re.match(r"^\d{1,4}\s", stripped) and re.match(r"^\s*\(\s*\+", body.strip()):
        stripped = "+" + stripped
    international = stripped.startswith("+")
    if not international and re.match(r"^\s*00\d", stripped):
        international = True
        stripped = re.sub(r"^\s*00", "+", stripped, count=1)
        notes.append("00_prefix_read_as_international")

    digits = re.sub(r"\D", "", stripped)
    if not digits:
        return None

    if international:
        for code in _CODES_BY_LENGTH:
            if digits.startswith(code):
                nsn = digits[len(code):]
                country, code_notes = _country_for_code(code, country_hint)
                notes.extend(code_notes)
                if country in KEEPS_LEADING_ZERO:
                    pass
                elif nsn.startswith("0"):
                    nsn = nsn.lstrip("0") or nsn
                    notes.append("stripped_trunk_zero")
                if not _valid_nsn(country, nsn):
                    notes.append(
                        f"national length {len(nsn)} is outside the range for "
                        f"{country or 'this code'}"
                    )
                    return Phone(raw=raw, digits=digits, country=country, national=nsn,
                                 extension=extension, confidence="ambiguous",
                                 notes=tuple(notes))
                e164 = f"+{code}{nsn}"
                if len(e164) - 1 > E164_MAX_DIGITS:
                    return None
                return Phone(raw=raw, digits=digits, e164=e164, country=country,
                             national=nsn, extension=extension,
                             confidence="certain" if country else "probable",
                             notes=tuple(notes))
        notes.append("no_known_calling_code")
        return Phone(raw=raw, digits=digits, extension=extension,
                     confidence="ambiguous", notes=tuple(notes))

    # National format. Without a country there is no E.164 form, and guessing one would
    # invent a business in another country.
    country = (country_hint or "").upper() or None
    if country is None or country not in CALLING_CODES:
        return Phone(raw=raw, digits=digits, extension=extension, confidence="ambiguous",
                     notes=tuple(notes + ["national format with no country hint"]))

    nsn = digits
    if country not in KEEPS_LEADING_ZERO and nsn.startswith("0"):
        nsn = nsn.lstrip("0") or nsn
        notes.append("stripped_trunk_zero")
    if not _valid_nsn(country, nsn):
        return Phone(raw=raw, digits=digits, country=country, national=nsn,
                     extension=extension, confidence="ambiguous",
                     notes=tuple(notes + [
                         f"national length {len(nsn)} is outside the range for {country}"]))
    return Phone(raw=raw, digits=digits, e164=f"+{CALLING_CODES[country]}{nsn}",
                 country=country, national=nsn, extension=extension,
                 confidence="probable",
                 notes=tuple(notes + [f"country supplied by hint {country}"]))


def find_phones(text: str, *, country_hint: Optional[str] = None,
                max_results: int = MAX_RESULTS) -> list[Phone]:
    """Find every plausible phone number in a fragment of text."""
    results: list[Phone] = []
    if not text:
        return results
    if len(text) > MAX_INPUT:
        text = text[:MAX_INPUT]

    seen: set[str] = set()
    for match in CANDIDATE.finditer(text):
        if len(results) >= max_results:
            break
        raw = match.group(0).strip()
        start, end = match.span()
        window = text[max(0, start - 40):min(len(text), end + 40)]

        # Pull a trailing extension into the candidate before parsing.
        tail = text[end:end + 24]
        extension_match = EXTENSION.match(tail.lstrip())
        if extension_match:
            raw = f"{raw} {extension_match.group(0)}"

        phone = parse_phone(raw, country_hint=country_hint, context=window)
        if phone is None:
            continue
        key = phone.e164 or phone.digits
        if key in seen:
            continue
        seen.add(key)
        results.append(Phone(**{**phone.__dict__, "start": start, "end": end}))
    return results


def parse_tel_href(href: str, *, country_hint: Optional[str] = None) -> Optional[Phone]:
    """Parse a ``tel:`` URI.

    The highest-precision source there is: the site has explicitly declared this string to
    be a phone number, so the structural rejection heuristics are not applied — only the
    normalization.
    """
    if not href:
        return None
    value = href.strip()
    if value.lower().startswith("tel:"):
        value = value[4:]
    value = value.replace("%2B", "+").strip()
    if not value:
        return None
    extension = None
    if ";ext=" in value:
        value, _, extension = value.partition(";ext=")
        extension = re.sub(r"\D", "", extension) or None
    value = value.split(";")[0].strip()
    if not re.search(r"\d", value):
        return None
    phone = parse_phone(value, country_hint=country_hint, context="tel: link")
    if phone is None:
        digits = re.sub(r"\D", "", value)
        if not digits:
            return None
        return Phone(raw=href, digits=digits, extension=extension,
                     confidence="ambiguous", notes=("from tel: link; unparsed",))
    if extension and not phone.extension:
        phone = Phone(**{**phone.__dict__, "extension": extension})
    return phone
