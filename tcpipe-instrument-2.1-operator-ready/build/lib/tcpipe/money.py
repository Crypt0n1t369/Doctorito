"""Money parsing (T2-02): amounts, currencies, VAT wording and pricing basis.

The hard problem here is one character. ``1.250`` is one thousand two hundred and fifty in
Riga, Tallinn, Berlin and Warsaw, and one and a quarter in London and New York. A parser
that picks wrong is off by a factor of a thousand, and a price that is wrong by 1000x is
worse than no price at all — it looks plausible in a spreadsheet.

So this module never silently picks. It returns its best reading, the competing reading
when one exists, and a confidence that says which situation it is:

* ``certain``  — the separators are unambiguous (``1.250,50``, ``1,250.50``, ``450,50``).
* ``probable`` — one reading is overwhelmingly more likely (``1.250`` as a price is
  thousands; three-decimal money essentially does not occur), or a locale hint settled it.
* ``ambiguous`` — both readings are defensible. ``alternative`` carries the other one.

Amounts are ``Decimal`` throughout. Money in binary floating point is a bug, not a
shortcut.

Everything is bounded and total: malformed input yields no results rather than an
exception, because the caller is a batch job over a thousand unknown pages.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Optional

MAX_INPUT = 200_000
MAX_RESULTS = 50
MAX_AMOUNT = Decimal("100000000")

# -- currency ---------------------------------------------------------------------------

#: Unambiguous symbols.
SYMBOL_CURRENCY = {
    "€": "EUR", "£": "GBP", "₺": "TRY", "₽": "RUB", "₴": "UAH", "₹": "INR",
    "¥": "JPY", "₩": "KRW", "₪": "ILS", "zł": "PLN", "Kč": "CZK", "Ft": "HUF",
    "лв": "BGN", "lei": "RON", "₡": "CRC", "R$": "BRL",
}

#: Symbols that need a locale hint. Guessing "$" as USD silently mislabels Canadian and
#: Australian prices, and "kr" spans four different Nordic currencies.
AMBIGUOUS_SYMBOL_CURRENCY = {
    "$": {"US": "USD", "CA": "CAD", "AU": "AUD", "NZ": "NZD", "SG": "SGD", "HK": "HKD"},
    "kr": {"SE": "SEK", "NO": "NOK", "DK": "DKK", "IS": "ISK"},
    "kr.": {"SE": "SEK", "NO": "NOK", "DK": "DKK", "IS": "ISK"},
}

ISO_CURRENCIES = frozenset({
    "EUR", "GBP", "USD", "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF", "RON", "BGN",
    "CHF", "TRY", "UAH", "RUB", "CAD", "AUD", "NZD", "SGD", "HKD", "JPY", "INR", "ZAR",
    "AED", "SAR", "BRL", "MXN", "ILS", "KRW", "CNY", "THB", "MYR", "PHP", "IDR",
})

#: Country -> (decimal separator, default currency). Used only as a hint.
LOCALE_RULES = {
    "LV": (",", "EUR"), "EE": (",", "EUR"), "LT": (",", "EUR"), "FI": (",", "EUR"),
    "DE": (",", "EUR"), "AT": (",", "EUR"), "NL": (",", "EUR"), "BE": (",", "EUR"),
    "FR": (",", "EUR"), "ES": (",", "EUR"), "IT": (",", "EUR"), "PT": (",", "EUR"),
    "IE": (".", "EUR"), "GR": (",", "EUR"), "SK": (",", "EUR"), "SI": (",", "EUR"),
    "HR": (",", "EUR"), "CY": (".", "EUR"), "MT": (".", "EUR"), "LU": (",", "EUR"),
    "SE": (",", "SEK"), "NO": (",", "NOK"), "DK": (",", "DKK"), "IS": (",", "ISK"),
    "PL": (",", "PLN"), "CZ": (",", "CZK"), "HU": (",", "HUF"), "RO": (",", "RON"),
    "BG": (",", "BGN"), "CH": (".", "CHF"), "TR": (",", "TRY"), "UA": (",", "UAH"),
    "GB": (".", "GBP"), "US": (".", "USD"), "CA": (".", "CAD"), "AU": (".", "AUD"),
    "NZ": (".", "NZD"), "IN": (".", "INR"), "ZA": (".", "ZAR"), "SG": (".", "SGD"),
}

# -- VAT and basis wording, in the languages this corpus actually contains ---------------

VAT_INCLUSIVE = (
    # English
    r"incl?\w*\.?\s*vat", r"including\s+vat", r"vat\s+incl", r"with\s+vat",
    # German / Dutch
    r"inkl\w*\.?\s*mwst", r"brutto", r"incl\w*\.?\s*btw",
    # Nordic
    r"inkl\w*\.?\s*(?:moms|mva|skat|skatt)", r"m/mva", r"med\s+moms",
    # Baltic
    r"ar\s+pvn", r"koos\s+k[äa]ibemaksuga", r"km-?ga", r"su\s+pvm",
    r"sisaldab?\w*\s+k[äa]ibemaksu", r"iek[lļ]auj\w*\s+pvn", r"ar\s+pvn\s+21",
    # Other
    r"z\s+vat", r"iva\s+incl", r"\bttc\b",
)

VAT_EXCLUSIVE = (
    # English
    r"ex(?:cl)?\w*\.?\s*vat", r"excluding\s+vat", r"plus\s+vat", r"\+\s*vat",
    r"vat\s+extra", r"vat\s+not\s+included", r"before\s+vat",
    # German / Dutch — abbreviated and spelled out
    r"netto", r"(?:zzgl|zuz[uü]glich)\w*\.?\s*mwst", r"ohne\s+mwst",
    r"ex(?:cl)?\w*\.?\s*btw",
    # Nordic: Swedish uses "exkl", Norwegian/Danish "ekskl"; both appear spelled out
    r"e(?:ks|x)kl\w*\.?\s*(?:moms|mva|skat|skatt)", r"uten\s+mva", r"utan\s+moms",
    r"uden\s+moms",
    # Baltic
    r"bez\s+pvn", r"k[äa]ibemaksuta", r"ilma\s+km-?ta", r"bez\s+pvm",
    # Other
    r"bez\s+vat", r"\bht\b", r"iva\s+excl",
)

BASIS_PATTERNS = (
    ("per_person", (r"per\s+person", r"per\s+participant", r"per\s+delegate",
                    r"per\s+student", r"per\s+trainee", r"per\s+candidate", r"\bp\.?p\.?\b",
                    r"pro\s+person", r"per\s+persoon", r"par\s+personne",
                    r"per\s+deltaker", r"per\s+deltagare", r"osalejale", r"par\s+personu",
                    r"no\s+personas", r"personai", r"osaleja\s+kohta", r"asmeniui",
                    r"per\s+henkil[öo]", r"pr\.?\s*person")),
    ("per_group", (r"per\s+group", r"group\s+rate", r"group\s+booking", r"per\s+team",
                   r"pro\s+gruppe", r"grupas\s+cena", r"grupile")),
    ("per_course", (r"per\s+course", r"per\s+programme", r"per\s+program", r"per\s+module",
                    r"pro\s+kurs", r"kursa\s+cena")),
    ("from", (r"\bfrom\b", r"\bstarting\s+(?:at|from)\b", r"\bab\b", r"\bfra\b",
              r"\bfrån\b", r"\bvanaf\b", r"\balates\b", r"\bno\b\s*(?=\d)", r"\bod\b")),
)

#: Precompiled, order-stable currency matchers. Longest symbols first so "kr." is tried
#: before "kr" and "R$" before "$".
_ISO_PATTERN = re.compile(r"(?<![A-Z])(?:" + "|".join(sorted(ISO_CURRENCIES)) + r")(?![A-Z])")
_SORTED_SYMBOLS = sorted(SYMBOL_CURRENCY.items(), key=lambda kv: (-len(kv[0]), kv[0]))
_SORTED_AMBIGUOUS = sorted(AMBIGUOUS_SYMBOL_CURRENCY.items(),
                           key=lambda kv: (-len(kv[0]), kv[0]))


# -- data -------------------------------------------------------------------------------


@dataclass(frozen=True)
class Money:
    """One parsed price, with the evidence and doubt that produced it."""

    amount: Decimal
    currency: Optional[str]
    raw: str
    basis: str = "unknown"
    includes_vat: Optional[bool] = None
    confidence: str = "certain"          # certain | probable | ambiguous
    alternative: Optional[Decimal] = None
    notes: tuple[str, ...] = ()
    #: True when the page stated a currency next to this number; False when it was only
    #: inferred from locale. A locale default makes every bare number look priced, so the
    #: distinction has to survive to whoever picks a winner.
    currency_explicit: bool = False
    #: The unit this number counts, when it counts something ("3 days", "12 participants").
    #: A counted quantity is not a price, however much it looks like one.
    quantity_unit: Optional[str] = None
    #: True when a price word ("fee", "cena", "pris") sits beside this number.
    price_word_nearby: bool = False
    start: int = 0
    end: int = 0

    @property
    def normalized(self) -> str:
        """``"EUR 1250.50"`` — the form stored in ``field_observation.normalized_value``."""
        amount = f"{self.amount:.2f}"
        return f"{self.currency} {amount}" if self.currency else amount

    def as_dict(self) -> dict:
        return {
            "amount": str(self.amount), "currency": self.currency, "basis": self.basis,
            "includes_vat": self.includes_vat, "confidence": self.confidence,
            "alternative": str(self.alternative) if self.alternative is not None else None,
            "notes": list(self.notes), "raw": self.raw,
            "currency_explicit": self.currency_explicit,
            "quantity_unit": self.quantity_unit,
            "price_word_nearby": self.price_word_nearby,
        }


# -- amount parsing ---------------------------------------------------------------------

_SPACE_CHARS = "     '’"
_NUMBER = re.compile(r"\d[\d     '’.,]*\d|\d")


def _strip_spaces(text: str) -> str:
    return "".join(ch for ch in text if ch not in _SPACE_CHARS)


def parse_amount(raw: str, *, locale_hint: Optional[str] = None
                 ) -> tuple[Optional[Decimal], str, Optional[Decimal], tuple[str, ...]]:
    """Parse a numeric token into ``(amount, confidence, alternative, notes)``.

    Returns ``(None, "failed", None, notes)`` rather than raising, and never guesses
    silently: whenever a competing reading exists it comes back in ``alternative``.
    """
    notes: list[str] = []
    text = (raw or "").strip()
    if not text:
        return None, "failed", None, ("empty",)

    # Nordic "450,-" and "450.-" mean a whole amount with no minor units.
    if re.fullmatch(r"[\d\s., ']*\d\s*[.,]-", text):
        text = text.rstrip("-").rstrip(".,").strip()
        notes.append("nordic_dash_notation")

    text = _strip_spaces(text)
    if not re.fullmatch(r"\d[\d.,]*", text):
        return None, "failed", None, tuple(notes + ["not_numeric"])

    has_dot, has_comma = "." in text, "," in text
    decimal_sep_hint = LOCALE_RULES.get((locale_hint or "").upper(), (None, None))[0]

    try:
        if has_dot and has_comma:
            # Both present: whichever comes last is the decimal separator. No ambiguity.
            if text.rfind(".") > text.rfind(","):
                value = Decimal(text.replace(",", ""))
            else:
                value = Decimal(text.replace(".", "").replace(",", "."))
            return _bounded(value), "certain", None, tuple(notes)

        separator = "." if has_dot else ("," if has_comma else None)
        if separator is None:
            return _bounded(Decimal(text)), "certain", None, tuple(notes)

        parts = text.split(separator)
        if len(parts) > 2:
            # 1.234.567 — repeated separators can only be grouping.
            return _bounded(Decimal("".join(parts))), "certain", None, tuple(notes)

        head, tail = parts
        if not head or not tail:
            return None, "failed", None, tuple(notes + ["malformed_separator"])

        if len(tail) in (1, 2):
            # 450,5 / 450,50 — grouping never produces one or two trailing digits.
            return _bounded(Decimal(f"{head}.{tail}")), "certain", None, tuple(notes)

        if len(tail) == 3:
            grouped = Decimal(head + tail)
            fractional = Decimal(f"{head}.{tail}")
            if head == "0":
                # 0.500 is a fraction; grouping cannot start with a zero group.
                return _bounded(fractional), "certain", None, tuple(notes)
            if decimal_sep_hint == separator:
                notes.append(f"locale_hint_{locale_hint}_reads_{separator!r}_as_decimal")
                notes.append("three_decimal_places_are_unusual_for_a_price")
                return (_bounded(grouped), "ambiguous", _bounded(fractional),
                        tuple(notes))
            if decimal_sep_hint is not None:
                notes.append(f"locale_hint_{locale_hint}_reads_{separator!r}_as_grouping")
                return _bounded(grouped), "certain", None, tuple(notes)
            # No hint. Grouping is overwhelmingly more likely for money, but the other
            # reading is 1000x away, so it travels with the result.
            notes.append("no_locale_hint; read as thousands grouping")
            return _bounded(grouped), "probable", _bounded(fractional), tuple(notes)

        # Four or more trailing digits is not a decimal fraction of a price.
        notes.append("unexpected_group_length")
        return _bounded(Decimal(head + tail)), "ambiguous", None, tuple(notes)
    except (InvalidOperation, ValueError):
        return None, "failed", None, tuple(notes + ["decimal_parse_failed"])


def _bounded(value: Decimal) -> Optional[Decimal]:
    if value < 0 or value > MAX_AMOUNT:
        return None
    return value


# -- currency, VAT, basis ---------------------------------------------------------------


def detect_currency(text: str, *, locale_hint: Optional[str] = None,
                    default_currency: Optional[str] = None
                    ) -> tuple[Optional[str], tuple[str, ...]]:
    """Find the currency in a fragment of text around an amount."""
    notes: list[str] = []
    if not text:
        return default_currency, ()
    upper = text.upper()

    # Earliest match wins. Iterating the set directly made the winner depend on set
    # ordering whenever two codes appeared in one window — a determinism bug.
    iso_match = _ISO_PATTERN.search(upper)
    symbol_hits = [(text.find(symbol), code)
                   for symbol, code in _SORTED_SYMBOLS if symbol in text]
    if iso_match and not symbol_hits:
        return iso_match.group(0), ()
    if symbol_hits and not iso_match:
        return min(symbol_hits)[1], ()
    if iso_match and symbol_hits:
        earliest_symbol = min(symbol_hits)
        return (iso_match.group(0) if iso_match.start() < earliest_symbol[0]
                else earliest_symbol[1]), ()

    for symbol, by_country in _SORTED_AMBIGUOUS:
        if re.search(rf"(?<![A-Za-z]){re.escape(symbol)}", text):
            country = (locale_hint or "").upper()
            if country in by_country:
                return by_country[country], (f"symbol_{symbol}_resolved_by_locale_{country}",)
            notes.append(
                f"symbol {symbol!r} is ambiguous across {sorted(set(by_country.values()))}; "
                "no locale hint"
            )
            return None, tuple(notes)

    if default_currency:
        return default_currency, ("currency_from_default",)
    hinted = LOCALE_RULES.get((locale_hint or "").upper(), (None, None))[1]
    if hinted:
        return hinted, (f"currency_inferred_from_locale_{locale_hint}",)
    return None, tuple(notes)


def detect_vat(text: str) -> Optional[bool]:
    """True if the text says VAT is included, False if excluded, None if silent."""
    lowered = _fold(text)
    for pattern in VAT_EXCLUSIVE:
        if re.search(pattern, lowered):
            return False
    for pattern in VAT_INCLUSIVE:
        if re.search(pattern, lowered):
            return True
    return None


def detect_basis(text: str) -> str:
    lowered = _fold(text)
    for basis, patterns in BASIS_PATTERNS:
        for pattern in patterns:
            if re.search(pattern, lowered):
                return basis
    return "unknown"


def _fold(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in folded if not unicodedata.combining(ch)).lower()


# -- scanning free text -----------------------------------------------------------------

_CONTEXT = 48

#: A number immediately followed by one of these counts something. Durations, group sizes
#: and module counts sit right next to prices on every course page.
_QUANTITY_UNIT = re.compile(
    r"^\s*(days?|day|hours?|hrs?|weeks?|months?|years?|nights?|minutes?|mins?"
    r"|participants?|people|persons?|delegates?|students?|trainees?|candidates?"
    r"|modules?|lessons?|sessions?|places?|seats?|pax"
    r"|dienas|dienam|stundas|menesi|gadi|gadus|dalibnieki"
    r"|paeva|paevad|tundi|kuud|aastat|osalejat"
    r"|tage|tagen|stunden|monate|jahre|teilnehmer"
    r"|dagar|dagen|timmar|timer|manader|deltakere|deltagare"
    r"|dni|godzin|uczestnikow)\b",
    re.IGNORECASE,
)

#: A unit can also PRECEDE its number — "group size 12", "max 20 participants". Only
#: checking what follows left "Group size 12" looking like a twelve-euro course.
_QUANTITY_PREFIX = re.compile(
    r"(?:size|max(?:imum)?|min(?:imum)?|capacity|up\s+to|limit(?:ed\s+to)?|group\s+of"
    r"|class\s+of|room\s+for|duration|lasts?|over|within"
    r"|lielums|maks|ilgums|kestus|suurus|dauer|grosse|storlek|lengd|rozmiar)"
    r"[\s:]*$",
    re.IGNORECASE,
)

#: Words that mark the number beside them as money rather than a count.
_PRICE_WORD = re.compile(
    r"\b(?:price|prices|cost|costs|fee|fees|rate|rates|tariff|charge|charges|from|only"
    r"|cena|cenas|maksa|hind|hinnad|tasu|pris|priser|preis|preise|kaina|cennik|prezzo"
    r"|precio|tarief|prijs)\b",
    re.IGNORECASE,
)


def parse_money(text: str, *, locale_hint: Optional[str] = None,
                default_currency: Optional[str] = None,
                default_includes_vat: Optional[bool] = None,
                max_results: int = MAX_RESULTS) -> list[Money]:
    """Find every price in a fragment of text.

    Deliberately conservative: a number with no currency anywhere near it and no default
    is still returned, but with ``currency=None`` so the caller can decide whether a bare
    number is worth anything. Course pages are full of numbers that are not prices —
    durations, group sizes, module counts — and this module does not pretend to tell them
    apart on its own. That is the classifier's job (T2-04).
    """
    results: list[Money] = []
    if not text:
        return results
    if len(text) > MAX_INPUT:
        text = text[:MAX_INPUT]

    for match in _NUMBER.finditer(text):
        if len(results) >= max_results:
            break
        token = match.group(0)
        if not any(ch.isdigit() for ch in token):
            continue

        start, end = match.span()
        # Include a trailing ",-" if present, before reading context.
        trailer = text[end:end + 2]
        if re.match(r"^[.,]-", trailer):
            token += trailer
            end += 2

        left = text[max(0, start - _CONTEXT):start]
        right = text[end:end + _CONTEXT]
        window = f"{left}{token}{right}"

        amount, confidence, alternative, notes = parse_amount(token,
                                                              locale_hint=locale_hint)
        if amount is None:
            continue

        near = f"{left[-12:]}{right[:12]}"
        explicit_currency, _ = detect_currency(near, locale_hint=None,
                                               default_currency=None)
        currency, currency_notes = detect_currency(
            near, locale_hint=locale_hint, default_currency=default_currency,
        )
        unit_match = _QUANTITY_UNIT.match(right)
        quantity_unit = unit_match.group(1).lower() if unit_match else None
        if quantity_unit is None:
            prefix_match = _QUANTITY_PREFIX.search(left)
            if prefix_match:
                quantity_unit = prefix_match.group(0).strip(" :").lower()
        unit_notes = ((f"followed by the unit {quantity_unit!r}; counts rather than costs",)
                      if quantity_unit else ())

        # A page-level statement ("Visas cenas ar PVN", "All prices exclude VAT") sits in
        # its own paragraph, far outside any one price's window. Falling back to it is the
        # difference between knowing every price's VAT status and knowing none of them.
        local_vat = detect_vat(window)
        vat_notes = ()
        if local_vat is None and default_includes_vat is not None:
            local_vat = default_includes_vat
            vat_notes = ("VAT status taken from a page-level statement",)

        results.append(Money(
            amount=amount, currency=currency, raw=token.strip(),
            basis=detect_basis(window), includes_vat=local_vat,
            confidence=confidence, alternative=alternative,
            notes=tuple(notes) + tuple(currency_notes) + unit_notes + vat_notes,
            currency_explicit=explicit_currency is not None,
            quantity_unit=quantity_unit,
            price_word_nearby=bool(_PRICE_WORD.search(near)),
            start=start, end=end,
        ))
    return results


#: Phrases that quantify over every price on the page. "All prices include VAT" is a
#: global statement; "€1,850 incl. VAT" is a fact about one price and must not be
#: inherited by its neighbours.
_GLOBAL_PRICE_PHRASE = re.compile(
    r"(?:all\s+(?:our\s+)?(?:prices|fees|rates|costs|charges)"
    r"|prices?\s+(?:are|is|shown|listed|quoted|include|includes|exclude|excludes)"
    r"|visas\s+cenas|k[oõ]ik\s+hinnad|hinnad\s+sisaldavad"
    r"|alle\s+preise|alla\s+priser|alle\s+priser|alle\s+prijzen"
    r"|wszystkie\s+ceny|tous\s+les\s+prix|todos\s+los\s+precios)",
    re.IGNORECASE,
)


def page_vat_statement(text: str, *, window: int = 120) -> Optional[bool]:
    """The VAT status a whole page declares, if it declares one *globally*.

    Requires a phrase that quantifies over every price. Without that requirement a single
    item's "incl. VAT" was inherited by every other price on the page, silently asserting a
    VAT status for prices that never stated one.

    Pass the result to ``parse_money(default_includes_vat=…)``.
    """
    if not text:
        return None
    for match in _GLOBAL_PRICE_PHRASE.finditer(text[:MAX_INPUT]):
        start = max(0, match.start() - window)
        verdict = detect_vat(text[start:match.end() + window])
        if verdict is not None:
            return verdict
    return None


def parse_price_range(text: str, *, locale_hint: Optional[str] = None,
                      default_currency: Optional[str] = None
                      ) -> Optional[tuple[Money, Money]]:
    """Recognise ``450–600 EUR`` / ``from 450 to 600`` as a low/high pair."""
    if not text:
        return None
    separator = re.search(r"\d\s*(?:[-–—]|\bto\b|\buntil\b|\bbis\b|\btill\b|\blidz\b)\s*\d",
                          _fold(text))
    if not separator:
        return None
    monies = parse_money(text, locale_hint=locale_hint, default_currency=default_currency)
    if len(monies) < 2:
        return None
    low, high = monies[0], monies[1]
    if high.amount < low.amount:
        low, high = high, low
    # A range whose halves differ by three orders of magnitude is almost certainly a
    # mis-split rather than a genuine price band.
    if low.amount > 0 and high.amount / low.amount > 1000:
        return None
    if high.currency is None and low.currency is not None:
        high = Money(**{**high.__dict__, "currency": low.currency})
    if low.currency is None and high.currency is not None:
        low = Money(**{**low.__dict__, "currency": high.currency})
    return low, high


def best_price(monies: list[Money]) -> Optional[Money]:
    """Pick the most trustworthy price from a set, or nothing.

    Prefers a stated currency and a confident reading. Returns None on an empty set rather
    than inventing a default, because "no price found" is a legitimate and common answer.
    """
    if not monies:
        return None
    # A number that counts something is not a candidate at all. "Duration 3 days" beat a
    # 950 EUR fee to first position purely by appearing earlier on the page.
    candidates = [m for m in monies if m.quantity_unit is None] or list(monies)
    rank = {"certain": 0, "probable": 1, "ambiguous": 2}
    # An explicitly marked currency outranks one merely inferred from locale, then
    # confidence, then position. Position breaks ties, not size: "the biggest number on
    # the page" is not a pricing rule.
    return sorted(
        candidates,
        key=lambda m: (not m.currency_explicit, not m.price_word_nearby,
                       m.currency is None, rank.get(m.confidence, 3), m.start),
    )[0]
