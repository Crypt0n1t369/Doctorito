import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "bin" / "tcpipe-agent"


class AgentWrapperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.db = root / "pilot.db"
        self.artifacts = root / "artifacts"
        self.env = {
            **os.environ,
            "PYTHONDONTWRITEBYTECODE": "1",
            "TCPIPE_DB": str(self.db),
            "TCPIPE_ARTIFACTS": str(self.artifacts),
            "TCPIPE_AGENT_ALLOW_EXTERNAL_STATE": "1",
        }

    def tearDown(self):
        self.temp.cleanup()

    def run_agent(self, *args):
        return subprocess.run(
            [str(WRAPPER), *args], cwd=ROOT, env=self.env,
            capture_output=True, text=True, check=False,
        )

    def test_init_and_readiness_use_fixed_state(self):
        created = self.run_agent("init")
        self.assertEqual(created.returncode, 0, created.stderr)
        report = json.loads(self.run_agent("readiness").stdout)
        self.assertEqual(report["route_count"], 5)
        self.assertEqual(report["ready_route_count"], 0)

    def test_network_approvals_and_audit_attestation_are_separate_gates(self):
        self.env["TCPIPE_AGENT_ALLOW_NETWORK"] = "0"
        self.assertEqual(self.run_agent("fetch", "--route", "RT-0001").returncode, 77)
        self.assertEqual(
            self.run_agent(
                "correction-decide", "--correction", "COR-X", "--decision", "accepted",
                "--by", "agent", "--rationale", "unchecked",
            ).returncode,
            77,
        )
        self.assertEqual(
            self.run_agent(
                "run", "--route", "RT-0001", "--attempt", "FA-X", "--audit-errors", "0"
            ).returncode,
            77,
        )

    def test_agent_cannot_override_paths_or_network_target(self):
        self.assertEqual(
            self.run_agent("status", "--db", "/tmp/not-the-governed-db").returncode, 64
        )
        self.assertEqual(
            self.run_agent("fetch", "--route", "RT-0001", "--url", "https://example.com").returncode,
            64,
        )

    def test_workspace_policy_cannot_enable_human_only_gates(self):
        policy = Path(self.temp.name) / "unsafe-policy.conf"
        policy.write_text("ALLOW_APPROVAL_DECISIONS=1\n", encoding="utf-8")
        self.env["TCPIPE_AGENT_POLICY"] = str(policy)
        result = self.run_agent("status")
        self.assertEqual(result.returncode, 77)
        self.assertIn("human-only gates", result.stderr)


if __name__ == "__main__":
    unittest.main()
