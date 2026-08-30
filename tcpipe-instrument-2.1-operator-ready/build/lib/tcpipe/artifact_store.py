"""Atomic, content-addressed artifact storage."""
from __future__ import annotations

import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path


class ArtifactIntegrityError(RuntimeError):
    pass


@dataclass(frozen=True)
class StoredArtifact:
    sha256: str
    byte_len: int
    storage_path: str


class ArtifactStore:
    def __init__(self, root: Path | str):
        self.root = Path(root).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path_for(self, digest: str) -> Path:
        if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise ValueError("digest must be 64 lowercase hexadecimal characters")
        return self.root / digest[:2] / digest[2:4] / digest

    def put_bytes(self, data: bytes) -> StoredArtifact:
        if not data:
            raise ValueError("zero-byte artifacts are not accepted")
        digest = hashlib.sha256(data).hexdigest()
        final = self.path_for(digest)
        final.parent.mkdir(parents=True, exist_ok=True)
        if final.exists():
            self._verify_path(final, digest, len(data))
            return StoredArtifact(digest, len(data), str(final))

        fd, temp_name = tempfile.mkstemp(prefix=".incoming-", dir=final.parent)
        temp = Path(temp_name)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temp, final)
            except FileExistsError:
                self._verify_path(final, digest, len(data))
            else:
                final.chmod(0o444)
                directory_fd = os.open(final.parent, os.O_RDONLY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
        finally:
            temp.unlink(missing_ok=True)
        return StoredArtifact(digest, len(data), str(final))

    def verify(self, digest: str) -> StoredArtifact:
        path = self.path_for(digest)
        if not path.is_file():
            raise ArtifactIntegrityError(f"artifact missing: {digest}")
        return self._verify_path(path, digest, path.stat().st_size)

    @staticmethod
    def _verify_path(path: Path, expected_digest: str, expected_len: int) -> StoredArtifact:
        hasher = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(block)
                size += len(block)
        if size != expected_len or hasher.hexdigest() != expected_digest:
            raise ArtifactIntegrityError(
                f"artifact mismatch at {path}: expected {expected_digest}/{expected_len}, "
                f"got {hasher.hexdigest()}/{size}"
            )
        return StoredArtifact(expected_digest, size, str(path))
