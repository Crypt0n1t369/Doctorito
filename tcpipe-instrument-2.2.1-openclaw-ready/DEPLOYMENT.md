# Deployment

The instrument is a Python package with a console entry point. It has exactly two pieces of
state — a SQLite database and a content-addressed artifact directory — and one command that
opens a socket (`tcpipe fetch`). Everything else is local computation over stored bytes.

## Install

```bash
pip install tcpipe_foundation-2.3.0-py3-none-any.whl
```

PDF routes (IALA) need the optional extra:

```bash
pip install "tcpipe_foundation[pdf]"
```

Without it every other route still runs; a PDF route fails with a message naming the
missing extra rather than a traceback.

## Configure

A harness sets these once in the environment instead of passing flags per call. Explicit
flags always override.

| Variable | Meaning |
|---|---|
| `TCPIPE_DB` | Path to the governed database |
| `TCPIPE_ARTIFACTS` | Path to the artifact store directory |
| `TCPIPE_PROXY` | Egress proxy URL for `fetch` |
| `TCPIPE_REQUIRE_PROXY` | `1` makes `fetch` refuse to run without a proxy |
| `TCPIPE_USER_AGENT` | Override the crawler user agent |

## Verify before running anything

```bash
tcpipe preflight
```

Exit code 0 means this deployment can actually run: package data present, SQLite ≥ 3.37,
required dependencies importable, database at the expected schema version, artifact volume
writable. Non-zero tells you which check failed. Wire this into your readiness probe — the
failures it catches otherwise surface halfway through an operator's first real command.

## First run

```bash
tcpipe init                    # create + seed the database, create the artifact dir
tcpipe migrate                 # upgrade 2.2 databases; new databases are already 2.3
tcpipe status                  # missions, coverage, attention items
tcpipe routes                  # the five seeded pilot routes
```

`init` refuses to overwrite an existing database.

## Container

```bash
docker build -t tcpipe:2.3.0 .
docker run --rm -v tcpipe-data:/data tcpipe:2.3.0 preflight
docker run --rm -v tcpipe-data:/data tcpipe:2.3.0 init
docker run --rm -v tcpipe-data:/data tcpipe:2.3.0 status
```

Runs as uid 10001, no build toolchain in the runtime image, `/data` is the only volume.
The healthcheck runs `preflight`.

## Scheduling recurring runs

There is no built-in scheduler — the instrument is a set of idempotent commands, so use
whatever your harness already has. A route run is two commands:

```bash
tcpipe fetch --route RT-0001                       # prints the attempt id
tcpipe run   --route RT-0001 --attempt FA-… --audit-errors 0
```

`fetch` and `run` must share an acquisition job, which is why `run` takes the attempt ids
that `fetch` printed. Enqueueing is idempotent, so a duplicate schedule fire is harmless.

For OpenClaw, `openclaw/INSTALL.md` sets up the guarded agent and optional daily oversight.
The agent runs fail-closed public preflight before ordinary public acquisition. It reads
`readiness.due_fetchable_routes`, fetches at most one bounded route, and passes
the returned attempt IDs into `run`; it must not invent an audit error count.

Cadence should follow each route's `refetch_days` (30 for GWO/IRATA/OPITO, 7 for OSHA, 90
for IALA). Running more often than that buys nothing: the transport sends conditional
requests and a 304 reuses the stored body rather than re-downloading it.

### systemd acquisition example

```ini
# /etc/systemd/system/tcpipe-run@.service
[Unit]
Description=tcpipe route acquisition %i
After=network-online.target

[Service]
Type=oneshot
User=tcpipe
Environment=TCPIPE_DB=/var/lib/tcpipe/pilot.db
Environment=TCPIPE_ARTIFACTS=/var/lib/tcpipe/artifacts
Environment=TCPIPE_PROXY=http://egress.internal:3128
Environment=TCPIPE_REQUIRE_PROXY=1
ExecStartPre=/usr/local/bin/tcpipe preflight
ExecStart=/usr/local/bin/tcpipe fetch --route %i
# Egress confinement belongs here, not in application code:
IPAddressDeny=any
IPAddressAllow=10.0.0.0/8
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/tcpipe
NoNewPrivileges=yes
```

This service acquires and records the attempt; a supervisor must pass its returned attempt
ID to `tcpipe run`. The `IPAddressDeny`/`IPAddressAllow` pair is the point.
`TCPIPE_REQUIRE_PROXY` makes the
process *ask* for a proxy; only the network layer can *make* it use one.

## Backups

Back up both together or neither — a database referencing artifacts you no longer have is
worse than no backup:

```bash
sqlite3 "$TCPIPE_DB" ".backup '/backup/pilot.db'"     # safe while running (WAL)
rsync -a "$TCPIPE_ARTIFACTS/" /backup/artifacts/       # append-only, content-addressed
```

Artifacts are immutable and content-addressed, so the artifact rsync is incremental
forever and never rewrites an existing object. Verify a restore with
`tcpipe doctor --db /backup/pilot.db --artifact-limit 0`, which rehashes every stored
artifact against its recorded digest.

## Concurrency and scale

One writer, many readers. SQLite in WAL mode with `BEGIN IMMEDIATE` claims is appropriate
for the pilot and a moderate worker fleet because artifacts live outside the database.
Parsing workers scale horizontally; database mutations stay behind the writer boundary.

Move to Postgres when measurement shows sustained writer-lock latency, multiple hosts
needing concurrent writes, or an availability requirement. Row count alone is not a
trigger.

## Public and human-gated acquisition

`tcpipe public-preflight --route RT-…` can create the current reviews and stored robots
artifact only for routes classified `public`. `tcpipe fetch --auto-public-preflight
--public-only` refreshes that automatically. Authenticated/private/sensitive routes,
robots prohibitions and access barriers still require human handling and may not be bypassed.

## OpenClaw workspace deployment

The source handoff is also an OpenClaw workspace. Run `./openclaw/setup-openclaw.sh` after
installing OpenClaw. It exposes only `bin/tcpipe-agent`, confines state to `work/`, denies
direct file edits, and keeps networking and human decisions behind separate controls. The
wheel alone does not contain these workspace files; use the complete exported folder/ZIP
for agent operation.
