"""Forward-only database migrations with an additive autonomous path."""
from __future__ import annotations

import hashlib
import re
import sqlite3
from pathlib import Path
from typing import Any

from .db import assert_db_integrity, open_db
from .resources import built_in_migration_path
from .writer import utc_now

CURRENT_SCHEMA_VERSION = "2.3.0"
BUILT_IN_ID = "2.2.0-to-2.3.0"
_PLACEHOLDER = "MIGRATION_SHA256_REPLACED_BY_RUNNER"

_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"--[^\n]*")
_STRING = re.compile(r"'(?:''|[^'])*'")
_DESTRUCTIVE = re.compile(
    r"\b(DROP|DELETE|UPDATE|REPLACE|TRUNCATE|VACUUM|ATTACH|DETACH|REINDEX|"
    r"BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b|PRAGMA\s+(?:writable_schema|journal_mode)",
    re.IGNORECASE,
)


class MigrationError(RuntimeError):
    pass


def _versions(con: sqlite3.Connection) -> set[str]:
    try:
        return {row[0] for row in con.execute("SELECT schema_version FROM schema_meta")}
    except sqlite3.Error as exc:
        raise MigrationError(f"schema_meta unavailable: {exc}") from exc


def _scrub_sql(sql: str) -> str:
    return _STRING.sub("''", _LINE_COMMENT.sub("", _BLOCK_COMMENT.sub("", sql)))


def validate_additive_sql(sql: str) -> None:
    """Reject destructive or host-escaping SQL from autonomous migrations."""
    scrubbed = _scrub_sql(sql)
    found = _DESTRUCTIVE.search(scrubbed)
    if found:
        raise MigrationError(
            f"autonomous migration contains human-gated operation: {found.group(0)}"
        )
    statements = _complete_statements(scrubbed)
    if not statements:
        raise MigrationError("migration contains no SQL statements")
    for statement in statements:
        normalized = " ".join(statement.strip().split()).upper()
        if normalized.startswith((
            "CREATE TABLE ", "CREATE UNIQUE INDEX ", "CREATE INDEX ",
            "CREATE TRIGGER ", "CREATE VIEW ", "INSERT INTO ",
        )):
            continue
        if normalized.startswith("ALTER TABLE ") and " ADD COLUMN " in normalized:
            continue
        raise MigrationError(
            "autonomous migrations are additive only; unsupported statement: "
            + normalized[:100]
        )


def _complete_statements(sql: str) -> list[str]:
    """Split SQL without breaking trigger bodies containing internal semicolons."""
    statements: list[str] = []
    pending = ""
    for line in sql.splitlines(keepends=True):
        pending += line
        if sqlite3.complete_statement(pending):
            if pending.strip():
                statements.append(pending)
            pending = ""
    if pending.strip():
        raise MigrationError("incomplete SQL migration")
    return statements


def _apply_built_in(con: sqlite3.Connection) -> dict[str, Any]:
    path = built_in_migration_path()
    source = path.read_text(encoding="utf-8")
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    sql = source.replace(_PLACEHOLDER, digest)
    if _PLACEHOLDER in sql:
        raise MigrationError("built-in migration placeholder replacement failed")
    con.executescript(sql)
    if CURRENT_SCHEMA_VERSION not in _versions(con):
        raise MigrationError("built-in migration did not install schema 2.3.0")
    assert_db_integrity(con)
    return {"migration_id": BUILT_IN_ID, "sha256": digest, "status": "applied"}


def _apply_project_migration(
    con: sqlite3.Connection, path: Path, *, actor: str
) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise MigrationError(f"migration must be a regular non-symlink file: {path}")
    migration_id = path.stem
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", migration_id):
        raise MigrationError(f"invalid migration filename: {path.name}")
    source = path.read_text(encoding="utf-8")
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    existing = con.execute(
        "SELECT sha256 FROM schema_migration WHERE migration_id=?", (migration_id,)
    ).fetchone()
    if existing:
        if existing["sha256"] != digest:
            raise MigrationError(f"applied migration changed on disk: {path.name}")
        return {"migration_id": migration_id, "sha256": digest, "status": "unchanged"}
    validate_additive_sql(source)
    statements = _complete_statements(source)
    con.execute("BEGIN IMMEDIATE")
    try:
        for statement in statements:
            con.execute(statement)
        con.execute(
            "INSERT INTO schema_migration VALUES (?,?,?,?)",
            (migration_id, digest, actor, utc_now()),
        )
        assert_db_integrity(con)
        con.execute("COMMIT")
    except Exception:
        if con.in_transaction:
            con.execute("ROLLBACK")
        raise
    return {"migration_id": migration_id, "sha256": digest, "status": "applied"}


def migrate_database(db_path: Path | str, *, migration_dir: Path | None, actor: str) -> dict:
    con = open_db(db_path, required_schema_version=None)
    applied: list[dict[str, Any]] = []
    try:
        versions = _versions(con)
        if CURRENT_SCHEMA_VERSION not in versions:
            if "2.2.0" not in versions:
                raise MigrationError(
                    f"no migration path from schema versions {sorted(versions)}"
                )
            applied.append(_apply_built_in(con))
        if migration_dir is not None:
            root = Path(migration_dir).expanduser().resolve()
            if not root.is_dir():
                raise MigrationError(f"migration directory not found: {root}")
            for path in sorted(root.glob("*.sql")):
                applied.append(_apply_project_migration(con, path, actor=actor))
        return {"schema_version": CURRENT_SCHEMA_VERSION, "migrations": applied}
    finally:
        con.close()
