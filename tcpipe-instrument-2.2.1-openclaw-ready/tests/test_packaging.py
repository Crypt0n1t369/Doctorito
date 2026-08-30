"""Guards against the failure that made this package undeployable.

The whole class of bug: code resolves a data file relative to the repository layout
(`Path(__file__).parents[2] / "schema.sql"`), which works in every test run from a checkout
and fails the instant the package is installed, because site-packages has no repository
above it. Nothing catches it until deployment day.

These tests assert the two invariants that keep it fixed: data is reached through
``tcpipe.resources``, and no shipped module walks up out of the package.
"""
from __future__ import annotations

import ast
import unittest
from pathlib import Path

import tcpipe
from tcpipe import resources
from tcpipe.adapter import load_rules

PACKAGE_ROOT = Path(tcpipe.__file__).resolve().parent
SHIPPED_MODULES = sorted(p for p in PACKAGE_ROOT.glob("*.py"))


class PackagedDataTests(unittest.TestCase):
    def test_runtime_version_matches_the_handoff(self):
        self.assertEqual(tcpipe.__version__, "2.3.0")

    def test_self_check_passes(self):
        report = resources.self_check()
        self.assertTrue(report["ok"], report.get("missing"))
        self.assertEqual(report["missing"], [])

    def test_every_required_data_file_is_reachable(self):
        for name in (resources.SCHEMA_SQL, resources.ADAPTER_RULES_SCHEMA,
                     resources.MISSIONS, resources.MISSIONS_SCHEMA,
                     resources.UNIVERSE_SEED, resources.UNIVERSE_SCHEMA):
            with self.subTest(name=name):
                path = resources.data_path(name)
                self.assertTrue(path.is_file())
                self.assertGreater(path.stat().st_size, 0)

    def test_schema_sql_is_the_real_ddl(self):
        sql = resources.schema_sql()
        self.assertIn("CREATE TABLE route_run", sql)
        self.assertIn("INSERT INTO schema_meta VALUES ('2.3.0'", sql)

    def test_every_shipped_adapter_loads_and_validates(self):
        ids = resources.shipped_adapter_ids()
        self.assertEqual(len(ids), 5, ids)
        for adapter_id in ids:
            with self.subTest(adapter=adapter_id):
                rules = load_rules(resources.adapter_path(adapter_id))
                self.assertEqual(rules["adapter_id"], adapter_id)

    def test_adapter_lookup_rejects_path_traversal(self):
        for bad in ("../schema", "a/b", "..", ".hidden"):
            with self.subTest(value=bad), self.assertRaises(ValueError):
                resources.adapter_path(bad)

    def test_missing_resource_names_the_likely_cause(self):
        with self.assertRaises(resources.ResourceMissing) as caught:
            resources.data_path("definitely-not-shipped.json")
        self.assertIn("package-data", str(caught.exception))


class NoRepoRelativePathsTests(unittest.TestCase):
    """No shipped module may reach above the package for its own data."""

    def test_no_module_walks_out_of_the_package(self):
        offenders = []
        for module in SHIPPED_MODULES:
            source = module.read_text(encoding="utf-8")
            tree = ast.parse(source)
            for node in ast.walk(tree):
                # Path(__file__).resolve().parents[N] — any N reaching outside the package
                if (isinstance(node, ast.Subscript)
                        and isinstance(node.value, ast.Attribute)
                        and node.value.attr == "parents"):
                    index = node.slice
                    if isinstance(index, ast.Constant) and isinstance(index.value, int):
                        if index.value >= 1 and module.name != "resources.py":
                            offenders.append(f"{module.name}: parents[{index.value}]")
        self.assertEqual(
            offenders, [],
            "these modules resolve paths relative to the repo layout and will break when "
            "installed; use tcpipe.resources instead",
        )

    def test_no_module_shells_out_to_the_scripts_directory(self):
        # `tcpipe init` used to subprocess scripts/bootstrap.py, which is not in the wheel.
        # Only real string literals count — a docstring explaining the old bug is not the bug.
        offenders = []
        for module in SHIPPED_MODULES:
            tree = ast.parse(module.read_text(encoding="utf-8"))
            docstrings = {
                id(node.body[0].value)
                for node in ast.walk(tree)
                if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef,
                                     ast.AsyncFunctionDef))
                and node.body and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
                and isinstance(node.body[0].value.value, str)
            }
            for node in ast.walk(tree):
                if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                        and id(node) not in docstrings
                        and ("scripts/bootstrap" in node.value
                             or node.value == "scripts")):
                    offenders.append(f"{module.name}: {node.value!r}")
        self.assertEqual(offenders, [],
                         "the scripts/ directory is not part of the installed package")


class BootstrapTests(unittest.TestCase):
    def test_bootstrap_creates_and_seeds_without_a_source_tree(self):
        import tempfile

        from tcpipe.bootstrap import BootstrapError, bootstrap

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report = bootstrap(root / "p.db", artifacts=root / "art")
            self.assertEqual(report["schema_version"], "2.3.0")
            self.assertEqual(report["seeded"], {"mission": 5, "source": 5, "route": 5})
            self.assertTrue((root / "art").is_dir())
            with self.assertRaises(BootstrapError):
                bootstrap(root / "p.db")


if __name__ == "__main__":
    unittest.main()
