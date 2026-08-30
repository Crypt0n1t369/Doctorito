import tempfile
import unittest
from pathlib import Path

from .support import ROOT
from tcpipe.artifact_store import ArtifactStore


class ArtifactStoreTests(unittest.TestCase):
    def test_put_is_content_addressed_idempotent_and_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ArtifactStore(directory)
            first = store.put_bytes(b"same bytes")
            second = store.put_bytes(b"same bytes")
            self.assertEqual(first, second)
            self.assertEqual(store.verify(first.sha256), first)
            self.assertEqual(Path(first.storage_path).stat().st_mode & 0o222, 0)

    def test_empty_artifact_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                ArtifactStore(directory).put_bytes(b"")


if __name__ == "__main__":
    unittest.main()

