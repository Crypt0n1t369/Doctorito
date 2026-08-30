import unittest

from tcpipe.phone import (
    Phone,
    find_phones,
    parse_phone,
    parse_tel_href,
    rejection_reason,
)


def e164(raw, hint=None):
    parsed = parse_phone(raw, country_hint=hint)
    return parsed.e164 if parsed else None


class InternationalFormatTests(unittest.TestCase):
    def test_common_international_forms(self):
        cases = {
            "+371 6700 1234": "+37167001234",
            "+372 600 9999": "+3726009999",
            "00371 67001234": "+37167001234",
            "+371-6700-1234": "+37167001234",
            "+47 7012 3456": "+4770123456",
            "+49 30 1234567": "+49301234567",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(e164(raw), expected)

    def test_bracketed_country_code_is_still_international(self):
        # "(+371) 6700 1234" is common; hiding the "+" inside brackets used to demote the
        # number to an un-normalizable national one.
        self.assertEqual(e164("(+371) 6700 1234"), "+37167001234")
        self.assertEqual(e164("(+44) 1224 555010"), "+441224555010")

    def test_bracketed_trunk_zero_is_dropped(self):
        # "+44 (0) 1224 555010" — keeping the 0 produces a number that does not dial.
        self.assertEqual(e164("+44 (0) 1224 555010"), "+441224555010")
        self.assertEqual(e164("+49 (0)30 1234567"), "+49301234567")

    def test_italy_keeps_its_leading_zero(self):
        # Most of Europe strips the trunk 0; Italian landlines keep it.
        self.assertEqual(e164("+39 06 12345678"), "+390612345678")

    def test_shared_calling_code_does_not_name_a_country_alone(self):
        parsed = parse_phone("+1 312 555 0100")
        self.assertEqual(parsed.e164, "+13125550100")
        self.assertIsNone(parsed.country, "+1 is both US and CA")
        self.assertEqual(parsed.confidence, "probable")
        self.assertEqual(parse_phone("+1 312 555 0100", country_hint="US").country, "US")

    def test_wrong_national_length_is_flagged_not_emitted(self):
        parsed = parse_phone("+371 670")          # LV numbers are 8 digits
        self.assertIsNone(parsed.e164)
        self.assertEqual(parsed.confidence, "ambiguous")


class NationalFormatTests(unittest.TestCase):
    def test_a_country_hint_makes_a_national_number_dialable(self):
        self.assertEqual(e164("6700 1234", "LV"), "+37167001234")
        self.assertEqual(e164("020 7946 0958", "GB"), "+442079460958")
        self.assertEqual(e164("0512 555020", "AT"), "+43512555020")
        self.assertEqual(e164("06.12.34.56.78", "FR"), "+33612345678")

    def test_without_a_country_there_is_no_e164(self):
        # An 8-digit national number is +371… in Riga and +372… in Tallinn — different
        # businesses. Guessing one would invent a contact.
        parsed = parse_phone("6700 1234")
        self.assertIsNone(parsed.e164)
        self.assertEqual(parsed.confidence, "ambiguous")
        self.assertEqual(parsed.normalized, "67001234", "the evidence still survives")

    def test_national_confidence_is_never_certain(self):
        self.assertEqual(parse_phone("6700 1234", country_hint="LV").confidence, "probable")


class RejectionTests(unittest.TestCase):
    """Precision: a wrong number in a contact export gets dialled."""

    def test_dates_are_rejected(self):
        for text in ("2026-08-20", "20.08.2026", "1/12/2026", "15-01-24", "2026/8/5"):
            with self.subTest(text=text):
                self.assertEqual(rejection_reason(text, text), "looks_like_a_date")

    def test_dot_separated_french_numbers_are_not_dates(self):
        # 06.12.34.56.78 begins with something date-shaped; a date has three components.
        self.assertIsNone(rejection_reason("06.12.34.56.78", "06.12.34.56.78"))

    def test_prices_are_rejected(self):
        for text in ("1250.00", "1,250.50", "1 250,00"):
            with self.subTest(text=text):
                self.assertEqual(rejection_reason(text, text), "looks_like_a_price")

    def test_other_impostors(self):
        cases = {
            ("1010", "address LV-1010 Riga"): "looks_like_a_postcode",
            ("40003123456", "VAT LV40003123456"): "looks_like_a_vat_or_bank_identifier",
            ("09:00-17:00", "open 09:00-17:00"): "looks_like_opening_hours",
            ("11111111", "11111111"): "placeholder_repeated_digit",
            ("123", "123"): "too_few_digits",
            ("125000", "course fee €125000 total"): "adjacent_to_a_currency",
        }
        for (text, context), expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(rejection_reason(text, context), expected)

    def test_real_numbers_survive_rejection(self):
        for text in ("+371 6700 1234", "6700 1234", "020 7946 0958",
                     "+33 6 12 34 56 78", "+49 30 1234567"):
            with self.subTest(text=text):
                self.assertIsNone(rejection_reason(text, text))

    def test_rejected_candidates_produce_nothing(self):
        self.assertIsNone(parse_phone("2026-08-20"))
        self.assertIsNone(parse_phone("1250.00"))


class ExtensionTests(unittest.TestCase):
    def test_extension_forms(self):
        cases = {
            "+371 6700 1234 ext. 205": ("+37167001234", "205"),
            "+44 1224 555010 x99": ("+441224555010", "99"),
            "+49 30 1234567 Durchwahl 12": ("+49301234567", "12"),
        }
        for raw, (number, extension) in cases.items():
            with self.subTest(raw=raw):
                parsed = parse_phone(raw)
                self.assertEqual(parsed.e164, number)
                self.assertEqual(parsed.extension, extension)

    def test_extension_appears_in_the_normalized_form(self):
        self.assertEqual(parse_phone("+371 6700 1234 ext. 205").normalized,
                         "+37167001234;ext=205")


class TelLinkTests(unittest.TestCase):
    """A tel: link is the site declaring the string to be a phone number."""

    def test_tel_hrefs(self):
        self.assertEqual(parse_tel_href("tel:+37167001234").e164, "+37167001234")
        self.assertEqual(parse_tel_href("tel:%2B3726009999").e164, "+3726009999")
        self.assertEqual(parse_tel_href("tel:+44-1224-555010;ext=99").normalized,
                         "+441224555010;ext=99")

    def test_national_tel_href_uses_the_country_hint(self):
        self.assertEqual(parse_tel_href("tel:67001234", country_hint="LV").e164,
                         "+37167001234")

    def test_junk_hrefs_return_nothing(self):
        for href in ("", "tel:", "mailto:a@b.c", "tel:abc"):
            with self.subTest(href=href):
                self.assertIsNone(parse_tel_href(href))


class FindPhonesTests(unittest.TestCase):
    PAGE = """Nordic Wind Academy, Ostas iela 4, LV-1010 Riga.
    Phone: +371 6700 1234 (ext. 205). Mobile +371 2900 0000.
    Course dates 2026-08-20 to 2026-09-15. Fee €1,250.50 per person.
    Office hours 09:00-17:00."""

    def test_finds_the_numbers_and_none_of_the_impostors(self):
        found = find_phones(self.PAGE, country_hint="LV")
        numbers = {p.e164 for p in found}
        self.assertIn("+37167001234", numbers)
        self.assertIn("+37129000000", numbers)
        for impostor in ("+20260820", "+12505", "+900017"):
            self.assertNotIn(impostor, numbers)
        self.assertLessEqual(len(found), 3, f"expected the two real numbers, got {numbers}")

    def test_results_are_deduplicated(self):
        text = "Call +371 6700 1234 or +371 6700 1234 today"
        self.assertEqual(len(find_phones(text)), 1)

    def test_offsets_are_recorded(self):
        for phone in find_phones(self.PAGE, country_hint="LV"):
            self.assertLess(phone.start, phone.end)
            self.assertTrue(phone.raw)


class RobustnessTests(unittest.TestCase):
    HOSTILE = ["", "   ", None, "no digits at all", "+" * 500, "(" * 200,
               "1" * 10000, "+371" + "9" * 400, "\x00\x01", "++--..(())",
               "+371 6700 1234 " * 400]

    def test_never_raises(self):
        for index, text in enumerate(self.HOSTILE):
            with self.subTest(case=index):
                try:
                    results = find_phones(text)
                    parse_phone(text or "")
                    parse_tel_href(text or "")
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"case {index} raised {type(exc).__name__}: {exc}")
                self.assertIsInstance(results, list)

    def test_output_is_bounded(self):
        self.assertLessEqual(len(find_phones("+371 6700 1234, " * 2000)), 30)

    def test_is_deterministic(self):
        text = "Call +371 6700 1234 or +372 600 9999 or 020 7946 0958"
        first = [p.as_dict() for p in find_phones(text, country_hint="GB")]
        second = [p.as_dict() for p in find_phones(text, country_hint="GB")]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
