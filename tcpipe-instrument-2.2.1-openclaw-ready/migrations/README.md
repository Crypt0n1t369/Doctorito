# Project-local migrations

The operating agent may add forward-only `.sql` migrations here and apply them with
`./bin/tcpipe-agent migrate`.

Autonomous migrations are deliberately additive. The runner rejects `DROP`, `DELETE`,
`UPDATE`, `REPLACE`, `TRUNCATE`, `VACUUM`, `ATTACH`, writable-schema pragmas, transaction
control and other destructive/escape statements. Destructive migrations require a human
operator and are not exposed through the agent wrapper.

Applied filenames and SHA-256 hashes are recorded in `schema_migration`; a changed applied
migration is rejected.

