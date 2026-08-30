import sqlite3
import tempfile
import unittest
from pathlib import Path

from tcpipe.migrations import MigrationError, migrate_database


LEGACY_SCHEMA = """
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
CREATE TABLE schema_meta(schema_version TEXT PRIMARY KEY,applied_at_utc TEXT);
INSERT INTO schema_meta VALUES('2.2.0','2026-08-19T00:00:00Z');
CREATE TABLE source_policy_review(
 source_policy_review_id TEXT PRIMARY KEY,source_id TEXT,decision TEXT,license_basis TEXT,
 allowed_purpose TEXT,data_categories_json TEXT,reviewed_by TEXT,evidence_artifact_sha TEXT,
 reviewed_at_utc TEXT,valid_until_utc TEXT);
CREATE TABLE route_policy_review(
 route_policy_review_id TEXT PRIMARY KEY,route_id TEXT,source_policy_review_id TEXT,
 decision TEXT,robots_state TEXT,robots_snapshot_sha TEXT,reviewed_by TEXT,
 reviewed_at_utc TEXT,valid_until_utc TEXT);
CREATE TABLE route(route_id TEXT PRIMARY KEY,source_id TEXT,acquisition_method TEXT);
CREATE TABLE job_queue(job_id TEXT PRIMARY KEY,status TEXT,claimed_at_utc TEXT,lease_expires_at_utc TEXT);
CREATE TABLE fetch_attempt(
 attempt_id TEXT PRIMARY KEY,job_id TEXT,route_id TEXT,outcome TEXT,requested_at_utc TEXT,
 source_policy_review_id TEXT,route_policy_review_id TEXT,robots_snapshot_sha TEXT,
 fetch_tier INTEGER,is_finalized INTEGER);
CREATE TABLE fetch_attempt_artifact(attempt_id TEXT,artifact_sha256 TEXT,role TEXT);
CREATE TABLE host_state(
 host TEXT PRIMARY KEY,consecutive_failures INTEGER DEFAULT 0,suspended_until_utc TEXT,
 suspension_cycles INTEGER DEFAULT 0,robots_sha256 TEXT,robots_fetched_at_utc TEXT,
 last_outcome TEXT,updated_at_utc TEXT);
CREATE TRIGGER fetch_attempt_policy_guard BEFORE INSERT ON fetch_attempt BEGIN SELECT 1; END;
CREATE TRIGGER fetch_attempt_finalize_guard BEFORE UPDATE ON fetch_attempt BEGIN SELECT 1; END;
"""


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "legacy.db"
        self.migrations = root / "migrations"
        self.migrations.mkdir()
        con = sqlite3.connect(self.db)
        con.executescript(LEGACY_SCHEMA)
        con.close()

    def tearDown(self):
        self.temp.cleanup()

    def test_trusted_upgrade_and_additive_project_migration_are_ledgered(self):
        (self.migrations / "001_agent_note.sql").write_text(
            "CREATE TABLE agent_note(id TEXT PRIMARY KEY, note TEXT) STRICT;\n",
            encoding="utf-8",
        )
        report = migrate_database(self.db, migration_dir=self.migrations, actor="test-agent")
        self.assertEqual(report["schema_version"], "2.3.0")
        con = sqlite3.connect(self.db)
        try:
            self.assertEqual(
                con.execute("SELECT count(*) FROM schema_migration").fetchone()[0], 2
            )
            columns = {row[1] for row in con.execute("PRAGMA table_info(route)")}
            self.assertIn("access_class", columns)
        finally:
            con.close()

    def test_destructive_agent_migration_is_rejected(self):
        (self.migrations / "001_bad.sql").write_text(
            "DROP TABLE route;\n", encoding="utf-8"
        )
        with self.assertRaisesRegex(MigrationError, "human-gated"):
            migrate_database(self.db, migration_dir=self.migrations, actor="test-agent")

    def test_applied_migration_cannot_change_on_disk(self):
        path = self.migrations / "001_note.sql"
        path.write_text("CREATE TABLE note(id TEXT PRIMARY KEY);\n", encoding="utf-8")
        migrate_database(self.db, migration_dir=self.migrations, actor="test-agent")
        path.write_text("CREATE TABLE changed(id TEXT PRIMARY KEY);\n", encoding="utf-8")
        with self.assertRaisesRegex(MigrationError, "changed on disk"):
            migrate_database(self.db, migration_dir=self.migrations, actor="test-agent")


if __name__ == "__main__":
    unittest.main()
