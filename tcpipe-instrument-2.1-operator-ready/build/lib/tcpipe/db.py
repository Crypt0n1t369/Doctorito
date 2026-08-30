"""SQLite connection preconditions for the governed database."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional, Union

MIN_SQLITE = (3, 37, 0)
REQUIRED_JOURNAL_MODE = "wal"


class DatabasePreconditionError(RuntimeError):
    pass


def _sqlite_version() -> tuple[int, ...]:
    return tuple(int(part) for part in sqlite3.sqlite_version.split("."))


def open_db(
    path: Union[str, Path],
    *,
    readonly: bool = False,
    require_wal: bool = True,
    verify_integrity: bool = False,
    required_schema_version: Optional[str] = None,
    timeout_s: float = 10.0,
) -> sqlite3.Connection:
    """Open a connection with enforced FKs and bounded lock waiting.

    Full ``foreign_key_check`` is optional because running it on every worker connection
    is not scalable. Run it at process startup, after migrations, and in invariant jobs.
    """
    if _sqlite_version() < MIN_SQLITE:
        raise DatabasePreconditionError(
            f"SQLite {sqlite3.sqlite_version} is older than required "
            f"{'.'.join(map(str, MIN_SQLITE))}"
        )
    if readonly:
        uri = Path(path).expanduser().resolve().as_uri() + "?mode=ro"
        con = sqlite3.connect(uri, uri=True, isolation_level=None, timeout=timeout_s)
    else:
        con = sqlite3.connect(str(path), isolation_level=None, timeout=timeout_s)
    try:
        con.row_factory = sqlite3.Row
        con.execute(f"PRAGMA busy_timeout = {int(timeout_s * 1000)}")
        con.execute("PRAGMA foreign_keys = ON")
        if con.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise DatabasePreconditionError("foreign_keys could not be enabled")
        if readonly:
            con.execute("PRAGMA query_only = ON")
        if require_wal:
            mode = con.execute("PRAGMA journal_mode").fetchone()[0].lower()
            if mode != REQUIRED_JOURNAL_MODE:
                raise DatabasePreconditionError(
                    f"journal_mode is {mode!r}; expected {REQUIRED_JOURNAL_MODE!r}"
                )
        if required_schema_version is not None:
            try:
                versions = {
                    row[0] for row in con.execute("SELECT schema_version FROM schema_meta")
                }
            except sqlite3.Error as exc:
                raise DatabasePreconditionError(f"schema_meta unavailable: {exc}") from exc
            if required_schema_version not in versions:
                raise DatabasePreconditionError(
                    f"schema version {required_schema_version!r} absent; found {sorted(versions)!r}"
                )
        if verify_integrity:
            violations = con.execute("PRAGMA foreign_key_check").fetchall()
            if violations:
                raise DatabasePreconditionError(
                    f"foreign_key_check found {len(violations)} violation(s); first={tuple(violations[0])!r}"
                )
        return con
    except Exception:
        con.close()
        raise


def assert_db_integrity(con: sqlite3.Connection) -> None:
    violations = con.execute("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise DatabasePreconditionError(
            f"foreign_key_check found {len(violations)} violation(s); first={tuple(violations[0])!r}"
        )


def self_test() -> int:
    import tempfile

    with tempfile.TemporaryDirectory() as directory:
        dirty = Path(directory) / "dirty.db"
        raw = sqlite3.connect(dirty)
        raw.executescript(
            "CREATE TABLE parent(id TEXT PRIMARY KEY) STRICT;"
            "CREATE TABLE child(id TEXT PRIMARY KEY, pid TEXT REFERENCES parent(id)) STRICT;"
            "PRAGMA journal_mode=WAL;"
        )
        raw.close()
        unsafe = sqlite3.connect(dirty)
        unsafe.execute("INSERT INTO child VALUES ('c','missing')")
        unsafe.commit()
        unsafe.close()
        try:
            open_db(dirty, verify_integrity=True)
        except DatabasePreconditionError:
            pass
        else:
            print("self-test failed: existing FK violation was accepted")
            return 1

        clean = Path(directory) / "clean.db"
        raw = sqlite3.connect(clean)
        raw.executescript(
            "CREATE TABLE parent(id TEXT PRIMARY KEY) STRICT;"
            "CREATE TABLE child(id TEXT PRIMARY KEY, pid TEXT REFERENCES parent(id)) STRICT;"
            "PRAGMA journal_mode=WAL;"
        )
        raw.close()
        con = open_db(clean, verify_integrity=True)
        try:
            con.execute("INSERT INTO child VALUES ('c','missing')")
        except sqlite3.IntegrityError:
            con.close()
            print("database precondition self-test passed")
            return 0
        con.close()
        print("self-test failed: new FK violation was accepted")
        return 1
