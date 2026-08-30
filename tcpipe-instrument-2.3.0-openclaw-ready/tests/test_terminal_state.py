import unittest

from .support import ROOT  # also installs src on sys.path
from tcpipe.terminal_state import TerminalInputs, calculate_terminal_state, verification_passed


def good(**changes):
    values = dict(
        freshness_state="fresh", published_count=2, count_quality="published",
        extracted_count=2, structural_count=2, container_resolved=True,
        variance_status="reconciled", audit_strategy="exhaustive",
        audit_sampled_count=2, audit_error_count=0, passing_fixture_count=1,
    )
    values.update(changes)
    return TerminalInputs(**values)


class TerminalStateTests(unittest.TestCase):
    def test_complete_published(self):
        self.assertEqual(calculate_terminal_state(good()).state, "complete_reconciled")

    def test_exhaustive_does_not_bypass_field_or_fixture_gates(self):
        self.assertFalse(verification_passed(good(field_health_blocked=True)))
        self.assertFalse(verification_passed(good(passing_fixture_count=0)))

    def test_derived_count_has_a_terminal_path(self):
        self.assertEqual(
            calculate_terminal_state(good(count_quality="derived_from_category_text")).state,
            "complete_reconciled_derived_count",
        )

    def test_paywall_is_reachable(self):
        self.assertEqual(calculate_terminal_state(good(access_status="paywall")).state, "blocked_paywall")

    def test_unknown_freshness_cannot_report_complete(self):
        self.assertEqual(calculate_terminal_state(good(freshness_state="unknown")).state, "unresolved")

    def test_unrecognised_enumerated_input_is_rejected(self):
        # The calculator is the replay authority; an input it does not understand must not
        # fall through the access checks into a completion verdict.
        for field, value in (
            ("access_status", "totally_bogus"),
            ("freshness_state", "probably_fine"),
            ("variance_status", "shrug"),
            ("audit_strategy", "vibes"),
            ("corroboration_state", "an_llm_said_so"),
            ("count_quality", "guessed"),
        ):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    calculate_terminal_state(good(**{field: value}))

    def test_sampled_audit_bound_must_not_contradict_its_own_error_count(self):
        sampled = dict(
            audit_strategy="stratified_random", audit_sampled_count=10, extracted_count=10,
            structural_count=10, published_count=10,
        )
        # Every sampled row was an error, yet the stored lower bound claims 0.99.
        self.assertFalse(verification_passed(good(audit_error_count=10, accuracy_lower_cp=0.99,
                                                  **sampled)))
        self.assertEqual(
            calculate_terminal_state(good(audit_error_count=10, accuracy_lower_cp=0.99,
                                          **sampled)).state,
            "unresolved",
        )
        # A bound consistent with the observed 100% accuracy still passes.
        self.assertTrue(verification_passed(good(audit_error_count=0, accuracy_lower_cp=0.96,
                                                 **sampled)))

    def test_unpublished_requires_defined_corroboration(self):
        inputs = good(published_count=None, count_quality="not_published")
        self.assertEqual(calculate_terminal_state(inputs).state, "unresolved")
        self.assertEqual(
            calculate_terminal_state(good(published_count=None, count_quality="not_published",
                                          corroboration_state="second_parser")).state,
            "complete_count_unpublished",
        )

    def test_empty_requires_deterministic_corroboration_and_no_veto(self):
        empty = good(published_count=0, extracted_count=0, structural_count=0,
                     audit_sampled_count=0, empty_corroborated=True,
                     corroboration_state="human_verified")
        self.assertEqual(calculate_terminal_state(empty).state, "verified_empty")
        self.assertEqual(calculate_terminal_state(
            good(published_count=0, extracted_count=0, structural_count=0,
                 audit_sampled_count=0, empty_corroborated=True,
                 corroboration_state="human_verified", llm_oracle_veto=True)
        ).state, "unresolved")
        self.assertEqual(calculate_terminal_state(
            good(published_count=0, extracted_count=0, structural_count=0,
                 audit_sampled_count=0, empty_corroborated=True,
                 corroboration_state="human_verified", passing_fixture_count=0)
        ).state, "unresolved")


if __name__ == "__main__":
    unittest.main()
