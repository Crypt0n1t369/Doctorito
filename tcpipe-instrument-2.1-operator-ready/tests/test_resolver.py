import sqlite3
import tempfile
import unittest
from pathlib import Path

from .support import ROOT
from tcpipe.db import open_db
from tcpipe.resources import schema_sql
from tcpipe.resolver import (
    CandidateCentre,
    IdentityKey,
    normalize_name,
    registrable_domain,
    resolve,
)


class NameNormalizationTests(unittest.TestCase):
    def test_folds_accents_punctuation_and_legal_form(self):
        self.assertEqual(normalize_name("Rīgas Ostas Centrs SIA"), "rigas ostas centrs")
        self.assertEqual(normalize_name("Baltic Safety Centre OÜ"), "baltic safety centre")
        self.assertEqual(normalize_name("Fjord Training A/S"), "fjord training")
        self.assertEqual(normalize_name("The Vertical Access Ltd."), "vertical access")

    def test_does_not_fold_away_a_distinguishing_place_name(self):
        # Two branches of one brand are two businesses with different addresses, phone
        # numbers and prices. Collapsing them would silently merge their data.
        self.assertNotEqual(normalize_name("Nordic Wind Academy"),
                            normalize_name("Nordic Wind Academy Norway"))


class DomainTests(unittest.TestCase):
    def test_registrable_domain(self):
        cases = {
            "https://www.example.co.uk/a/b": "example.co.uk",
            "http://sub.deep.example.com": "example.com",
            "balticsafety.ee": "balticsafety.ee",
            "https://WWW.Example.COM/": "example.com",
            "https://provider.com.au/x": "provider.com.au",
        }
        for value, expected in cases.items():
            with self.subTest(value=value):
                self.assertEqual(registrable_domain(value), expected)

    def test_rejects_non_domains(self):
        for value in ("", "localhost", "192.168.0.1", "not a url"):
            self.assertIsNone(registrable_domain(value))


class IdentityRankTests(unittest.TestCase):
    def test_provider_id_outranks_domain_outranks_name(self):
        candidate = CandidateCentre(
            display_name="Alpha Centre", country_iso2="LV",
            website_url="https://alpha.lv", provider_ids=(("SRC-1", "WINDA-1"),),
        )
        keys = candidate.build_keys()
        self.assertEqual([k.kind for k in keys],
                         ["official_provider_id", "domain", "name_country"])
        self.assertEqual(keys[0].rank, 1)


class ResolutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        path = Path(self.temp.name) / "r.db"
        raw = sqlite3.connect(path)
        raw.executescript(schema_sql())
        raw.close()
        self.con = open_db(path, required_schema_version="2.2.0")
        self.con.execute(
            "INSERT INTO mission VALUES ('M','parsing_capability','t','p','d',1,0,1,'2020-01-01T00:00:00Z')"
        )
        self.con.execute(
            """INSERT INTO job_queue (job_id,mission_id,kind,params_json,git_commit,
                 idempotency_key,created_at_utc,updated_at_utc)
               VALUES ('J','M','parse','{}','c','k','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')"""
        )

    def tearDown(self):
        self.con.close()
        self.temp.cleanup()

    def add_centre(self, centre_id, name, domain=None, identifiers=()):
        self.con.execute(
            """INSERT INTO centre (centre_id,display_name,registrable_domain,entity_state,
                 created_by_job_id,created_at_utc,updated_at_utc)
               VALUES (?,?,?, 'active','J','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z')""",
            (centre_id, name, domain),
        )
        for kind, value, scope in identifiers:
            self.con.execute("INSERT INTO centre_identifier VALUES (?,?,?,?)",
                             (kind, value, scope, centre_id))

    def test_new_candidate_is_created(self):
        result = resolve(self.con, CandidateCentre(display_name="New Centre",
                                                   website_url="https://new.example"))
        self.assertTrue(result.is_new)
        self.assertEqual(result.blockers, ())

    def test_provider_id_matches_existing_centre(self):
        self.add_centre("C-1", "Alpha Centre", "alpha.lv",
                        identifiers=[("official_provider_id", "WINDA-1", "SRC-1")])
        result = resolve(self.con, CandidateCentre(
            display_name="Alpha Centre", website_url="https://alpha.lv",
            provider_ids=(("SRC-1", "WINDA-1"),)))
        self.assertEqual(result.centre_id, "C-1")
        self.assertFalse(result.is_new)

    def test_no_identity_evidence_is_blocked(self):
        result = resolve(self.con, CandidateCentre(display_name=""))
        self.assertIsNone(result.centre_id)
        self.assertIn("no identity evidence", result.blockers[0])

    def test_equal_rank_conflict_goes_to_review_not_to_a_guess(self):
        self.add_centre("C-1", "Alpha", "alpha.lv",
                        identifiers=[("domain", "alpha.lv", "")])
        self.add_centre("C-2", "Alpha", None,
                        identifiers=[("legacy_tc_id", "alpha|LV", "name_country")])
        result = resolve(self.con, CandidateCentre(
            display_name="Alpha", country_iso2="LV", website_url="https://alpha.lv"))
        # domain (rank 2) beats name_country (rank 3), so this one resolves outright
        self.assertEqual(result.centre_id, "C-1")

        self.add_centre("C-3", "Beta", None,
                        identifiers=[("official_provider_id", "P-1", "SRC-A")])
        self.add_centre("C-4", "Beta", None,
                        identifiers=[("official_provider_id", "P-2", "SRC-A")])
        conflict = resolve(self.con, CandidateCentre(
            display_name="Beta", provider_ids=(("SRC-A", "P-1"), ("SRC-A", "P-2"))))
        self.assertIsNone(conflict.centre_id)
        self.assertIn("ambiguous identity", conflict.blockers[0])

    def test_same_domain_but_incompatible_name_is_blocked(self):
        self.add_centre("C-1", "Aberdeen Offshore Training", "shared.example",
                        identifiers=[("domain", "shared.example", "")])
        result = resolve(self.con, CandidateCentre(
            display_name="Completely Different Marine College",
            website_url="https://shared.example/other"))
        self.assertIsNone(result.centre_id)
        self.assertIn("incompatible names", result.blockers[0])

    def test_name_containment_is_treated_as_compatible(self):
        self.add_centre("C-1", "Vertical Access", "va.example",
                        identifiers=[("domain", "va.example", "")])
        result = resolve(self.con, CandidateCentre(
            display_name="Vertical Access Ltd", website_url="https://va.example"))
        self.assertEqual(result.centre_id, "C-1")

    def test_merged_centre_is_not_reused(self):
        self.add_centre("C-1", "Alpha", "alpha.lv",
                        identifiers=[("domain", "alpha.lv", "")])
        self.add_centre("C-2", "Alpha Survivor", "survivor.lv")
        self.con.execute(
            "UPDATE centre SET entity_state='merged_into',merged_into_id='C-2' WHERE centre_id='C-1'"
        )
        result = resolve(self.con, CandidateCentre(display_name="Alpha",
                                                   website_url="https://alpha.lv"))
        self.assertIsNone(result.centre_id)
        self.assertIn("merged", result.blockers[0])


if __name__ == "__main__":
    unittest.main()
