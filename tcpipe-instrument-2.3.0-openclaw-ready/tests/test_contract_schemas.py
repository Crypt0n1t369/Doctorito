import json
import unittest

from jsonschema import Draft202012Validator, FormatChecker, ValidationError

from tcpipe.resources import data_path


class ContractSchemaTests(unittest.TestCase):
    def validate(self, document, schema_name):
        schema = json.loads(data_path(schema_name).read_text(encoding="utf-8"))
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(document)

    def test_seed_universe_and_missions_validate(self):
        self.validate(json.loads(data_path("source-universe.seed.json").read_text()),
                      "source-universe.schema.json")
        self.validate(json.loads(data_path("missions.json").read_text()),
                      "missions.schema.json")

    def test_adapter_requires_fixture_and_honest_fallback_policy(self):
        selector = {
            "primary": {"strategy": "css_text", "value": ".name"},
            "fallback_policy": "none_with_reason",
            "fallback_reason": "The official download exposes only one stable column mapping."
        }
        adapter = {
            "adapter_id": "test__list", "version": "1.0.0", "output_contract_version": "2.1",
            "applies_to": {"url_pattern": "example\\.invalid"},
            "list": {"container": selector, "row": selector, "empty_is_valid": False,
                     "structural_count": selector},
            "fields": {"published_name": {"selector": selector}},
            "fixtures": ["a" * 64]
        }
        self.validate(adapter, "adapter-rules.schema.json")
        adapter.pop("fixtures")
        with self.assertRaises(ValidationError):
            self.validate(adapter, "adapter-rules.schema.json")


if __name__ == "__main__":
    unittest.main()
