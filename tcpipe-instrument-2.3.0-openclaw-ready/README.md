# tcpipe foundation 2.3.0

tcpipe is a governed, evidence-preserving instrument for comprehensive parsing of
training-centre sources. It is not a user-facing product.

Start with `00-README-HANDOFF.md`. Human operators use `OPERATOR-GUIDE.md`; OpenClaw
operators use `openclaw/INSTALL.md` and the guarded `bin/tcpipe-agent` command.
Version 2.3.0 adds bounded autonomous maintenance and fail-closed public-source preflight;
see `AUTONOMY-CHANGES-2.3.0.md` for the exact boundary.

Verify the complete handoff with:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 scripts/verify_bundle.py
```
