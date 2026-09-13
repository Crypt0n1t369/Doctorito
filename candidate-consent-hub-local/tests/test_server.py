import tempfile
import unittest
from pathlib import Path

import server


class CandidateHubTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.original_db_path = server.DB_PATH
        server.DB_PATH = Path(self.tempdir.name) / "test.db"
        server.init_db(seed=False)

    def tearDown(self):
        server.DB_PATH = self.original_db_path
        self.tempdir.cleanup()

    def test_schema_has_workflow_indexes(self):
        with server.connect_db() as db:
            names = {
                row["name"]
                for row in db.execute(
                    "SELECT name FROM sqlite_schema WHERE type = 'index' AND name LIKE 'idx_%'"
                ).fetchall()
            }
        self.assertIn("idx_candidates_status", names)
        self.assertIn("idx_candidates_eligibility", names)
        self.assertIn("idx_candidates_consent_beta", names)
        self.assertIn("idx_consent_candidate_time", names)

    def test_candidate_import_upserts_by_email(self):
        with server.connect_db() as db:
            first, created = server.create_or_update_candidate(
                db,
                {
                    "first_name": "Aija",
                    "email": "AIJA@EXAMPLE.TEST",
                    "eligibility": "review_required",
                },
            )
            second, created_again = server.create_or_update_candidate(
                db,
                {
                    "first_name": "Aija",
                    "email": "aija@example.test",
                    "eligibility": "eligible",
                },
            )
        self.assertTrue(created)
        self.assertFalse(created_again)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(second["eligibility"], "eligible")

    def test_summary_counts_all_human_review_states(self):
        with server.connect_db() as db:
            server.create_or_update_candidate(
                db, {"email": "legal@example.test", "status": "legal_review"}
            )
            server.create_or_update_candidate(
                db, {"email": "interest@example.test", "status": "interested_unverified"}
            )
            summary = server.summary_payload(db)
        self.assertEqual(summary["totals"]["review_queue"], 2)

    def test_consent_creates_separate_audit_events(self):
        with server.connect_db() as db:
            candidate, _ = server.create_or_update_candidate(
                db,
                {"first_name": "Janis", "email": "janis@example.test", "eligibility": "eligible"},
            )
            updated = server.apply_consent(
                db,
                {
                    "token": candidate["consent_token"],
                    "action": "grant",
                    "cv_match": True,
                    "direct_email": True,
                    "direct_phone": False,
                },
            )
            events = db.execute(
                "SELECT scope, decision FROM consent_events WHERE candidate_id = ? ORDER BY id",
                (candidate["id"],),
            ).fetchall()
        self.assertEqual(updated["status"], "consented")
        self.assertEqual(updated["consent_cv_status"], "granted")
        self.assertEqual(updated["consent_contact_status"], "granted")
        self.assertEqual(updated["consent_phone_status"], "declined")
        self.assertEqual([(row["scope"], row["decision"]) for row in events], [
            ("cv_matching", "granted"),
            ("direct_email", "granted"),
            ("direct_phone", "declined"),
        ])

    def test_independent_form_allows_beta_without_cv_permission(self):
        with server.connect_db() as db:
            candidate, _ = server.create_or_update_candidate(
                db, {"email": "beta@example.test", "eligibility": "eligible"}
            )
            updated = server.apply_consent(
                db,
                {
                    "token": candidate["consent_token"],
                    "action": "grant",
                    "beta_shortlist": True,
                    "cv_match": False,
                    "direct_email": False,
                    "direct_phone": False,
                },
            )
            events = db.execute(
                "SELECT scope, decision FROM consent_events WHERE candidate_id = ? ORDER BY id",
                (candidate["id"],),
            ).fetchall()
        self.assertEqual(updated["status"], "consented")
        self.assertEqual(updated["consent_beta_status"], "granted")
        self.assertEqual(updated["consent_cv_status"], "declined")
        self.assertEqual(updated["consent_contact_status"], "declined")
        self.assertEqual(
            [(row["scope"], row["decision"]) for row in events],
            [
                ("beta_shortlist", "granted"),
                ("cv_matching", "declined"),
                ("direct_email", "declined"),
                ("direct_phone", "declined"),
            ],
        )

    def test_independent_form_records_recruitment_choice_separately(self):
        with server.connect_db() as db:
            candidate, _ = server.create_or_update_candidate(
                db, {"email": "recruitment@example.test", "eligibility": "eligible"}
            )
            updated = server.apply_consent(
                db,
                {
                    "token": candidate["consent_token"],
                    "action": "grant",
                    "beta_shortlist": False,
                    "cv_match": True,
                    "direct_email": True,
                    "direct_phone": False,
                },
            )
        self.assertEqual(updated["consent_beta_status"], "declined")
        self.assertEqual(updated["consent_cv_status"], "granted")
        self.assertEqual(updated["consent_contact_status"], "granted")
        self.assertEqual(updated["consent_phone_status"], "declined")

    def test_webhook_is_idempotent_and_updates_suppression(self):
        with server.connect_db() as db:
            candidate, _ = server.create_or_update_candidate(
                db,
                {"first_name": "Liene", "email": "liene@example.test", "status": "invited"},
            )
            event = {"id": "evt_1", "type": "lead.unsubscribed", "data": {"email": candidate["email"]}}
            first, inserted = server.ingest_smartlead_event(db, event, "request-1")
            second, inserted_again = server.ingest_smartlead_event(db, event, "request-1")
            updated = server.candidate_by_email(db, candidate["email"])
            count = db.execute("SELECT COUNT(*) FROM campaign_events").fetchone()[0]
        self.assertTrue(inserted)
        self.assertFalse(inserted_again)
        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])
        self.assertEqual(updated["status"], "do_not_contact")
        self.assertEqual(updated["consent_contact_status"], "withdrawn")
        self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
