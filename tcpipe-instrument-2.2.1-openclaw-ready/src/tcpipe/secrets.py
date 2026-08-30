"""Minimal output redaction for errors and reports crossing the operator boundary."""
from __future__ import annotations

import re

_USERINFO = re.compile(r"(https?://)[^/@\s]+@", re.IGNORECASE)
_NAMED_SECRET = re.compile(
    r"(?i)(password|passwd|token|api[_-]?key|secret|authorization)(\s*[=:]\s*)([^\s&,;]+)"
)


def redact_secrets(value: object) -> str:
    text = str(value)
    text = _USERINFO.sub(r"\1[REDACTED]@", text)
    return _NAMED_SECRET.sub(r"\1\2[REDACTED]", text)
