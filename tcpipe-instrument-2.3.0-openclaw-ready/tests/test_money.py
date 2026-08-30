import unittest
from decimal import Decimal

from tcpipe.money import (
    Money,
    best_price,
    detect_basis,
    detect_currency,
    detect_vat,
    parse_amount,
    parse_money,
    parse_price_range,
)


def amount(raw, hint=None):
    return parse_amount(raw, locale_hint=hint)[0]


def confidence(raw, hint=None):
    return parse_amount(raw, locale_hint=hint)[1]


class SeparatorTests(unittest.TestCase):
    """The 1000x bug: `1.250` is 1250 in Riga and 1.25 in London."""

    def test_both_separators_present_is_never_ambiguous(self):
        self.assertEqual(amount("1.250,50"), Decimal("1250.50"))
        self.assertEqual(amount("1,250.50"), Decimal("1250.50"))
        self.assertEqual(confidence("1.250,50"), "certain")
        self.assertEqual(confidence("1,250.50"), "certain")

    def test_one_or_two_trailing_digits_is_always_decimal(self):
        # Thousands grouping cannot produce a group of one or two digits.
        self.assertEqual(amount("450,50"), Decimal("450.50"))
        self.assertEqual(amount("450.50"), Decimal("450.50"))
        self.assertEqual(amount("450,5"), Decimal("450.5"))
        for raw in ("450,50", "450.50", "450,5"):
            self.assertEqual(confidence(raw), "certain")

    def test_repeated_separators_are_always_grouping(self):
        self.assertEqual(amount("1.234.567"), Decimal("1234567"))
        self.assertEqual(amount("1,234,567"), Decimal("1234567"))
        self.assertEqual(confidence("1.234.567"), "certain")

    def test_three_trailing_digits_without_a_hint_reports_both_readings(self):
        value, conf, alternative, _ = parse_amount("1.250")
        self.assertEqual(value, Decimal("1250"))
        self.assertEqual(conf, "probable")
        self.assertEqual(alternative, Decimal("1.250"),
                         "the 1000x-away reading must travel with the result")

    def test_a_locale_hint_settles_the_grouping_case(self):
        # LV writes 1.250 for one thousand two hundred and fifty.
        self.assertEqual(parse_amount("1.250", locale_hint="LV")[:2],
                         (Decimal("1250"), "certain"))
        # GB writes "." as a decimal point, so 1.250 is genuinely contested.
        value, conf, alternative, _ = parse_amount("1.250", locale_hint="GB")
        self.assertEqual(conf, "ambiguous")
        self.assertEqual(alternative, Decimal("1.250"))
        self.assertEqual(parse_amount("1,250", locale_hint="GB")[:2],
                         (Decimal("1250"), "certain"))

    def test_leading_zero_group_is_a_fraction_not_grouping(self):
        # Grouping never starts a group with a zero, so 0.500 is unambiguous.
        self.assertEqual(parse_amount("0.500")[:2], (Decimal("0.500"), "certain"))

    def test_space_and_apostrophe_grouping(self):
        for raw in ("1 250,50", "1 250,50", "1'250.50", "1 250,50"):
            with self.subTest(raw=raw):
                self.assertEqual(amount(raw), Decimal("1250.50"))

    def test_nordic_dash_notation(self):
        self.assertEqual(amount("450,-"), Decimal("450"))
        self.assertEqual(amount("1.250,-"), Decimal("1250"))

    def test_amounts_are_decimal_not_float(self):
        value = amount("0,10")
        self.assertIsInstance(value, Decimal)
        self.assertEqual(value * 3, Decimal("0.30"), "float would give 0.30000000000000004")

    def test_junk_fails_without_raising(self):
        for raw in ("", "   ", "abc", "..", ",,", "-", "1.2.3,4,5", None):
            with self.subTest(raw=raw):
                value, conf, _, _ = parse_amount(raw)
                if value is not None:
                    self.assertIsInstance(value, Decimal)
                else:
                    self.assertEqual(conf, "failed")

    def test_absurd_magnitudes_are_rejected(self):
        self.assertIsNone(amount("9" * 30))


class CurrencyTests(unittest.TestCase):
    def test_iso_codes_and_unambiguous_symbols(self):
        self.assertEqual(detect_currency("1250 EUR")[0], "EUR")
        self.assertEqual(detect_currency("£1450")[0], "GBP")
        self.assertEqual(detect_currency("1250 zł")[0], "PLN")
        self.assertEqual(detect_currency("2 500 Kč")[0], "CZK")

    def test_ambiguous_symbols_refuse_to_guess(self):
        # "$" is six currencies and "kr" is four. Picking USD by default silently
        # mislabels Canadian and Australian prices.
        currency, notes = detect_currency("$850")
        self.assertIsNone(currency)
        self.assertTrue(any("ambiguous" in note for note in notes))
        self.assertEqual(detect_currency("$850", locale_hint="CA")[0], "CAD")
        self.assertEqual(detect_currency("12 500 kr", locale_hint="NO")[0], "NOK")
        self.assertEqual(detect_currency("12 500 kr", locale_hint="SE")[0], "SEK")

    def test_detection_is_deterministic_with_two_candidates(self):
        # Iterating a set made the winner depend on set ordering.
        results = {detect_currency("100 USD or 90 EUR")[0] for _ in range(20)}
        self.assertEqual(results, {"USD"}, "earliest match must win, every time")

    def test_locale_supplies_a_currency_when_the_page_does_not(self):
        self.assertEqual(detect_currency("1250", locale_hint="LV")[0], "EUR")
        self.assertIsNone(detect_currency("1250")[0])


class VatAndBasisTests(unittest.TestCase):
    def test_vat_wording_across_languages(self):
        # Abbreviated and spelled-out forms both occur in the wild, and Swedish "exkl"
        # differs from Norwegian "ekskl" by one letter.
        inclusive = ("incl. VAT", "including VAT", "with VAT", "inkl. MwSt", "brutto",
                     "inkl. moms", "inklusive moms", "med moms", "ar PVN",
                     "koos käibemaksuga", "km-ga", "TTC")
        exclusive = ("excl. VAT", "excluding VAT", "+ VAT", "plus VAT", "before VAT",
                     "netto", "zzgl. MwSt", "zuzüglich MwSt", "ohne MwSt",
                     "exkl. moms", "exklusive moms", "ekskl. mva", "eksklusiv mva",
                     "uten mva", "uden moms", "bez PVN", "käibemaksuta", "ilma km-ta")
        for text in inclusive:
            with self.subTest(inclusive=text):
                self.assertIs(detect_vat(text), True)
        for text in exclusive:
            with self.subTest(exclusive=text):
                self.assertIs(detect_vat(text), False)
        self.assertIsNone(detect_vat("1250 EUR"))

    def test_exclusive_wording_wins_over_a_substring_match(self):
        # "excl. VAT" contains "cl. VAT"; the exclusive check must be tried first.
        self.assertIs(detect_vat("Price 1250 EUR excl. VAT"), False)

    def test_basis_across_languages(self):
        cases = {
            "per person": "per_person", "per delegate": "per_person",
            "pro Person": "per_person", "per deltaker": "per_person",
            "no personas": "per_person", "osaleja kohta": "per_person",
            "group booking": "per_group", "grupas cena": "per_group",
            "per course": "per_course", "from 450": "from",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(detect_basis(text), expected)
        self.assertEqual(detect_basis("1250 EUR"), "unknown")


class ExtractionTests(unittest.TestCase):
    def test_realistic_course_pages(self):
        cases = [
            ("GWO BST — €1,250.50 per person incl. VAT", None,
             "EUR 1250.50", "per_person", True),
            ("Kursa cena: 1.250,00 EUR ar PVN, no personas", "LV",
             "EUR 1250.00", "per_person", True),
            ("BOSIET £1,450 + VAT per delegate", "GB",
             "GBP 1450.00", "per_person", False),
            ("Pris: 12 500 kr ekskl. mva per deltaker", "NO",
             "NOK 12500.00", "per_person", False),
            ("Preis ab 1.250 € zzgl. MwSt pro Person", "DE",
             "EUR 1250.00", "per_person", False),
        ]
        for text, hint, normalized, basis, vat in cases:
            with self.subTest(text=text):
                price = best_price(parse_money(text, locale_hint=hint))
                self.assertIsNotNone(price)
                self.assertEqual(price.normalized, normalized)
                self.assertEqual(price.basis, basis)
                self.assertIs(price.includes_vat, vat)

    def test_a_page_level_vat_statement_is_inherited(self):
        # "Visas cenas ar PVN" sits in its own paragraph, far outside any one price's
        # window. Without inheritance every price on the page has an unknown VAT status.
        from tcpipe.money import page_vat_statement

        page = "GWO BST 1 250,00 EUR. BOSIET 1 450,00 EUR. Visas cenas ar PVN."
        vat = page_vat_statement(page)
        self.assertIs(vat, True)
        price = best_price(parse_money("1 250,00 EUR", locale_hint="LV",
                                       default_includes_vat=vat))
        self.assertIs(price.includes_vat, True)
        self.assertIn("page-level", " ".join(price.notes))

    def test_per_price_wording_beats_the_page_default(self):
        price = best_price(parse_money("950 EUR incl. VAT", locale_hint="LV",
                                       default_includes_vat=False))
        self.assertIs(price.includes_vat, True)

    def test_price_ranges(self):
        low, high = parse_price_range("Group booking from 450 to 600 EUR")
        self.assertEqual((low.amount, high.amount), (Decimal("450"), Decimal("600")))
        self.assertEqual(low.currency, "EUR")
        self.assertEqual(high.currency, "EUR", "a shared currency propagates across a range")

    def test_a_thousandfold_range_is_rejected_as_a_mis_split(self):
        self.assertIsNone(parse_price_range("call 450 - 600000 for details"))

    def test_counted_quantities_are_not_prices(self):
        """A course page states durations, group sizes and prices side by side.

        The counts appear first, so ranking by position alone picked "3" out of
        "Duration 3 days" ahead of a 950 EUR fee.
        """
        cases = [
            ("Duration 3 days, 12 participants. Fee 950 EUR per person.", "LV", "EUR 950.00"),
            ("BOSIET: 5 days training, price €1,250.50 incl. VAT", "LV", "EUR 1250.50"),
            ("3 modules over 2 weeks. 1 250,00 EUR ar PVN", "LV", "EUR 1250.00"),
            ("Group size 12. Cost 850 per person", "LV", "EUR 850.00"),
            ("Max 20 participants. Price 1450", "GB", "GBP 1450.00"),
            ("Up to 15 delegates, fee 2 500 EUR", "LV", "EUR 2500.00"),
        ]
        for text, hint, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(best_price(parse_money(text, locale_hint=hint)).normalized,
                                 expected)

    def test_quantity_units_are_recorded_on_both_sides_of_the_number(self):
        monies = {m.raw: m for m in parse_money("Duration 3 days for group size 12")}
        self.assertEqual(monies["3"].quantity_unit, "days")
        self.assertEqual(monies["12"].quantity_unit, "size", "the unit may precede it")

    def test_an_explicit_currency_outranks_one_inferred_from_locale(self):
        # A locale default makes every bare number look priced, so the distinction has to
        # survive to whoever picks a winner.
        monies = parse_money("12 places left, fee 950 EUR", locale_hint="LV")
        marked = [m for m in monies if m.currency_explicit]
        self.assertTrue(marked)
        self.assertEqual(best_price(monies).normalized, "EUR 950.00")

    def test_bare_numbers_keep_no_currency_rather_than_inventing_one(self):
        price = best_price(parse_money("Course duration 3 days, group size 12"))
        self.assertIsNotNone(price, "numbers are still reported")
        self.assertIsNone(price.currency, "but a duration must not acquire a currency")

    def test_best_price_prefers_a_stated_currency_then_confidence_then_position(self):
        monies = parse_money("from 99 — full price 1,450 EUR per person")
        self.assertEqual(best_price(monies).currency, "EUR")

    def test_every_result_carries_its_raw_text_and_offsets(self):
        for price in parse_money("Fees: €450 and €1,250 per person"):
            self.assertTrue(price.raw)
            self.assertLess(price.start, price.end)

    def test_serialisable(self):
        price = best_price(parse_money("€1,250.50 incl. VAT"))
        payload = price.as_dict()
        self.assertEqual(payload["currency"], "EUR")
        self.assertEqual(payload["amount"], "1250.50")
        self.assertIs(payload["includes_vat"], True)


class RobustnessTests(unittest.TestCase):
    HOSTILE = [
        "", "   ", None, "no numbers here at all", "..,,..", "-" * 100,
        "1" * 5000, "€" * 1000, "\x00\x01\x02", "1,2,3,4,5,6,7,8,9",
        "€1.250,50" * 500, "   ", "1.2.3.4.5",
    ]

    def test_never_raises(self):
        for index, text in enumerate(self.HOSTILE):
            with self.subTest(case=index):
                try:
                    results = parse_money(text)
                    parse_price_range(text)
                    best_price(results)
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"case {index} raised {type(exc).__name__}: {exc}")
                self.assertIsInstance(results, list)

    def test_output_is_bounded(self):
        self.assertLessEqual(len(parse_money("€10 " * 5000)), 50)

    def test_is_deterministic(self):
        text = "Prices: €450, 1.250,00 EUR, $99, 12 500 kr per person incl. VAT"
        first = [m.as_dict() for m in parse_money(text, locale_hint="LV")]
        second = [m.as_dict() for m in parse_money(text, locale_hint="LV")]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
