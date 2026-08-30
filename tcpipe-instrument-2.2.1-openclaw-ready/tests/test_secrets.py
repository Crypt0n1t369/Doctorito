import unittest

from tcpipe.secrets import redact_secrets


class SecretRedactionTests(unittest.TestCase):
    def test_url_userinfo_and_named_secrets_are_redacted(self):
        text = redact_secrets(
            "proxy=https://alice:hunter2@example.com token=abc123 api_key=qwerty"
        )
        self.assertNotIn("hunter2", text)
        self.assertNotIn("abc123", text)
        self.assertNotIn("qwerty", text)
        self.assertIn("[REDACTED]", text)


if __name__ == "__main__":
    unittest.main()
