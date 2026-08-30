import unittest

from tcpipe.consensus import (
    MANY_VALUED,
    MAX_SCORE,
    Claim,
    canonical,
    observation_rows,
    reconcile,
    reconcile_field,
    review_items,
    summarize,
)


def claims(field_name, *pairs):
    return [Claim(field_name, value, source) for value, source in pairs]


class AgreementTests(unittest.TestCase):
    """Formatting differences must not manufacture conflicts."""

    def test_equivalent_values_agree_after_normalization(self):
        cases = [
            ("price_text", "EUR 1250.00", "1,250.00 EUR"),
            ("price_text", "1250", "EUR 1250.00"),
            ("published_phone", "+371 6700 1234", "0037167001234"),
            ("published_name", "Baltic Safety Centre OÜ", "Baltic Safety Centre"),
            ("published_country", "lv", "LV"),
            ("published_locality", "Rīga", "riga"),
            ("published_website", "https://baltic.example/", "https://www.baltic.example"),
        ]
        for field_name, first, second in cases:
            with self.subTest(field=field_name, first=first):
                result = reconcile_field(field_name,
                                         claims(field_name, (first, "json_ld"),
                                                (second, "visible_text")))
                self.assertEqual(result.status, "corroborated")
                self.assertIsNotNone(result.value)

    def test_agreement_across_sources_raises_the_score(self):
        one = reconcile_field("published_name", claims("published_name",
                                                       ("Baltic Safety Centre", "json_ld")))
        three = reconcile_field("published_name", claims(
            "published_name", ("Baltic Safety Centre", "json_ld"),
            ("Baltic Safety Centre", "microdata"), ("Baltic Safety Centre", "visible_text")))
        self.assertEqual(one.status, "single_source")
        self.assertEqual(three.status, "corroborated")
        self.assertGreater(three.score, one.score)

    def test_score_never_claims_certainty(self):
        result = reconcile_field("published_name", claims(
            "published_name", ("Baltic Safety Centre", "json_ld"),
            ("Baltic Safety Centre", "microdata"), ("Baltic Safety Centre", "tel_link")))
        self.assertLessEqual(result.score, MAX_SCORE)
        self.assertLess(result.score, 1.0, "generic extraction is never certain")


class ConflictTests(unittest.TestCase):
    def test_stale_structured_data_against_the_visible_table(self):
        """The commonest real disagreement: the site updated one and not the other."""
        result = reconcile_field("price_text", [
            Claim("price_text", "EUR 950.00", "json_ld", locator="/html/head/script[1]",
                  quote="price: 950 EUR"),
            Claim("price_text", "EUR 1250.00", "table_column",
                  locator="/html/body/table/tr[2]/td[3]", quote="1 250,00 EUR"),
        ])
        self.assertEqual(result.status, "conflict")
        self.assertIsNone(result.value, "precedence orders review, it does not decide truth")
        self.assertEqual(result.score, 0.0)
        self.assertEqual(result.validation_state, "flagged")
        self.assertIn("EUR 950.00", result.alternatives)
        self.assertIn("EUR 1250.00", result.alternatives)

    def test_a_conflict_keeps_every_claim_and_its_evidence(self):
        result = reconcile_field("published_country", claims(
            "published_country", ("LV", "json_ld"), ("EE", "visible_text")))
        self.assertEqual(result.status, "conflict")
        self.assertEqual(len(result.claims), 2)
        self.assertTrue(all(claim.source for claim in result.claims))

    def test_the_higher_precision_source_is_listed_first_for_review(self):
        result = reconcile_field("published_name", claims(
            "published_name", ("Template Default", "opengraph"),
            ("Actual Centre Name", "json_ld")))
        self.assertEqual(result.status, "conflict")
        self.assertEqual(result.alternatives[0], "Actual Centre Name")

    def test_conflicts_become_review_items(self):
        consensus = reconcile([
            Claim("price_text", "EUR 950.00", "json_ld"),
            Claim("price_text", "EUR 1250.00", "table_column"),
            Claim("published_name", "Baltic Safety Centre", "json_ld"),
        ])
        items = review_items(consensus)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["field"], "price_text")
        self.assertEqual(items[0]["review_kind"], "field_validation")
        self.assertEqual(len(items[0]["candidates"]), 2)


class ManyValuedTests(unittest.TestCase):
    def test_several_courses_are_not_a_conflict(self):
        result = reconcile_field("certificate_name", claims(
            "certificate_name", ("GWO BST", "json_ld"), ("GWO BSTR", "json_ld"),
            ("BOSIET", "table_column")))
        self.assertNotEqual(result.status, "conflict")
        self.assertIn("GWO BSTR", result.alternatives + [result.value])
        self.assertIn("BOSIET", result.alternatives + [result.value])

    def test_several_phone_numbers_are_not_a_conflict(self):
        result = reconcile_field("published_phone", claims(
            "published_phone", ("+37167001234", "tel_link"),
            ("+37129000000", "visible_text")))
        self.assertNotEqual(result.status, "conflict")

    def test_single_valued_fields_are_not_in_the_many_set(self):
        for field_name in ("published_name", "published_country", "published_locality",
                           "price_text"):
            self.assertNotIn(field_name, MANY_VALUED)


class OutputTests(unittest.TestCase):
    def test_tier_2_observations_are_never_accepted(self):
        consensus = reconcile([
            Claim("published_name", "Baltic Safety Centre", "json_ld"),
            Claim("price_text", "EUR 950.00", "json_ld"),
            Claim("price_text", "EUR 1250.00", "table_column"),
        ])
        rows = observation_rows(consensus)
        self.assertTrue(rows)
        for row in rows:
            self.assertIn(row["validation_state"], ("pending", "flagged"))
            self.assertNotEqual(row["validation_state"], "accepted")

    def test_conflicting_rows_carry_the_conflict_flag(self):
        consensus = reconcile([
            Claim("price_text", "EUR 950.00", "json_ld"),
            Claim("price_text", "EUR 1250.00", "table_column"),
        ])
        for row in observation_rows(consensus):
            self.assertIn("extractor_conflict", row["validation_flags_json"])
            self.assertEqual(row["validation_state"], "flagged")

    def test_every_row_keeps_its_source_and_evidence(self):
        consensus = reconcile([
            Claim("published_phone", "+37167001234", "tel_link",
                  locator="/html/body/a[1]", quote="+371 6700 1234"),
        ])
        row = observation_rows(consensus)[0]
        self.assertEqual(row["field_locator"], "/html/body/a[1]")
        self.assertEqual(row["evidence_quote"], "+371 6700 1234")
        self.assertIn("source:tel_link", row["validation_flags_json"])

    def test_summary_buckets_every_field(self):
        consensus = reconcile([
            Claim("published_name", "Baltic Safety Centre", "json_ld"),
            Claim("published_name", "Baltic Safety Centre", "microdata"),
            Claim("published_country", "LV", "json_ld"),
            Claim("price_text", "EUR 950.00", "json_ld"),
            Claim("price_text", "EUR 1250.00", "table_column"),
        ])
        report = summarize(consensus)
        self.assertEqual(report["fields"], 3)
        self.assertEqual(report["corroborated"], ["published_name"])
        self.assertEqual(report["single_source"], ["published_country"])
        self.assertEqual(report["conflict"], ["price_text"])


class RobustnessTests(unittest.TestCase):
    def test_empty_and_blank_inputs(self):
        self.assertEqual(reconcile([]), {})
        result = reconcile_field("published_name", [Claim("published_name", "  ", "json_ld")])
        self.assertEqual(result.status, "none")
        self.assertEqual(result.validation_state, "flagged")

    def test_never_raises_on_junk_values(self):
        junk = ["", "   ", "\x00", "€€€", "-", "?" * 500, "1.2.3.4.5"]
        for value in junk:
            with self.subTest(value=value):
                try:
                    consensus = reconcile([Claim("price_text", value, "json_ld"),
                                           Claim("published_phone", value, "visible_text")])
                    observation_rows(consensus)
                    review_items(consensus)
                    summarize(consensus)
                except Exception as exc:  # pragma: no cover - this is the assertion
                    self.fail(f"{value!r} raised {type(exc).__name__}: {exc}")

    def test_unknown_field_falls_back_to_folded_comparison(self):
        result = reconcile_field("mystery_field", claims(
            "mystery_field", ("Some Value", "json_ld"), ("some value", "visible_text")))
        self.assertEqual(result.status, "corroborated")

    def test_unknown_source_gets_a_default_precision(self):
        result = reconcile_field("published_name",
                                 [Claim("published_name", "X", "brand_new_extractor")])
        self.assertEqual(result.status, "single_source")
        self.assertGreater(result.score, 0.0)

    def test_output_is_bounded(self):
        many = [Claim("certificate_name", f"Course {i}", "json_ld") for i in range(10_000)]
        consensus = reconcile(many)
        self.assertIn("certificate_name", consensus)

    def test_is_deterministic(self):
        subject = [
            Claim("published_name", "Baltic Safety Centre", "json_ld"),
            Claim("published_name", "Baltic Safety", "opengraph"),
            Claim("price_text", "EUR 950.00", "json_ld"),
            Claim("price_text", "EUR 1250.00", "table_column"),
        ]
        first = {k: v.as_dict() for k, v in reconcile(subject).items()}
        second = {k: v.as_dict() for k, v in reconcile(subject).items()}
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
