# Staging migration preflight — 2026-11-09

The [read-only receipt](meld-staging-migration-preflight.json) records a fresh
schema and migration-ledger inspection after privately matching the configured
connection to the existing staging Hyperdrive. PostgreSQL enforced a read-only
transaction and five-second statement timeout. No application rows, schema
mutations, journal edits, deployments or original Git ref writes were performed.

The database contains `users.telegram_ai_replies` with the expected boolean,
non-null/default-true definition. It still lacks `assets.color_grid`. Its Drizzle
ledger has 49 rows: 48 match the proposed integration source by both committed
SQL hash and journal timestamp; one does not. That unmatched hash was not found
among the 50 historical migration SQL blobs reachable from the inspected
main/staging histories. This does not exclude another branch or application.

The latest recorded timestamp precedes both source migrations `0048` and `0049`.
The pinned ORM's timestamp selection would therefore choose both. The committed
Telegram migration is unrecorded even though its column already exists. Running
the standard migrator blindly could attempt that column again before reaching
the missing `color_grid` migration. No migration was executed to test that failure.

The existing [PR 203](https://github.com/yourmeld/meld2/pull/203) and
[PR 205](https://github.com/yourmeld/meld2/pull/205) bodies describe avoiding the
conflicting migration branches during their deployments; they leave integration
and database reconciliation separate. The current setup runbook also states the
staging controller does not run migrations. Older migration README deployment
wording must not be interpreted as permission to run them automatically.

The owner must identify the unmatched entry and the operation that created the
Telegram column, confirm the database target and review a reconciliation plan
before any write. Preserve applied history; do not delete the unmatched entry,
replace the journal or mark a migration applied simply to suppress an error.
The approved additive `color_grid` migration can follow a reconciled history.

The staging and configured production Hyperdrive origin tuples differ. This
metadata comparison does not prove physical database isolation or grant shared
database migration authority. Exact private target/ledger metadata and the owner
handoff remain local; credentials were neither printed nor copied into evidence.
