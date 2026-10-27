# Persistent protection revision fence — 2026-10-27

## Problem and change

The first conditional CLI writer advanced its revision in application code.
Rolling back to a build from before that counter allowed its existing SQL writer
to change protections without advancing the revision. A previously exported
file could then appear current despite an intervening edit.

Insert/update/delete triggers now advance the persistent counter at the SQLite
write boundary. They keep working when earlier application code writes the same
table. A legacy application increment can advance the counter further, which is
safe: revisions are opaque increasing integers, not contiguous edit counts.
Changing data and restoring its prior contents cannot revive an old export.

Sequencer startup installs the fence in Cloudflare's synchronous storage
transaction. Installing or repairing an incomplete fence first advances an
existing counter, invalidating pre-fence exports without rewriting any policy.
Repeated initialization with the complete fence does not advance it. The schema
and triggers remain compatible with the existing policy table and older writers.
The platform's [transactionSync contract](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactions)
provides atomic installation and rollback; the local real Worker verifies trigger
behavior using the same SQLite storage API.

The existing configuration RPC advertises `revisionTracking: "storage"` after
installation. New native CLI reads and edits wait with 503/Retry-After if an
older receiver lacks that capability. An older mutation method is not invoked
without readiness, and there is no unconditional fallback. Existing browser
reads remain available during rollout. CLI 0.4.5 needs no new permissions or
binary change; users must re-export pre-upgrade configuration files.

## Verification

- All **228 API unit tests** pass, including legacy insert/update/delete and
  replacement writes, restored-content invalidation, older double increments,
  migration rollback, partial trigger repair, repeated initialization and
  capability checks on mixed-version reads/edits.
- Full repository gate: **180 focused unit tests** plus every smoke invocation
  pass. The real Worker smoke uses a test-only raw SQL writer, matching the old
  write shapes without calling the new policy store. It verifies stale-export
  denial, unchanged content after an edit/restore cycle, harmless counter gaps,
  atomic rollback of both policy and counter, and restart persistence.
- Existing native Git/HTTP overlapping-lock enforcement, current admin scopes,
  source/review/deployment gates, aliases, archive interruption recovery, MCP
  retention and clone/fsck regressions pass.
- Pinned tsrs API, web and web Worker pass. The final OpenNext build and
  `git diff --check` pass. CLI source/distribution remains unchanged at 0.4.5;
  its 28-test gate and actual published installer passed in the preceding release.

The raw SQL test hook exists only in the local fixture entrypoint, which is not
referenced by either production Wrangler configuration. No production rollback
or legacy write was performed as a test.

## Approved production CLI test

Before this fence rollout, the user-approved one-day credential passed the
actual published CLI's protection creation, stale-edit refusal and removal on
Worker **086c3a3b-555e-4735-a9e3-97465c85a224**. Only
`cli-protection-smoke-20261027/**` was created/removed. Original policies,
refs, PR head and computed review gate remained unchanged. The credential was
immediately revoked; both identity and protection reads return 401. The private
token input was deleted and the REPL token cleared. Activity retains both
**via CLI** events; Connect shows no active CLI credentials.
See [the production test receipt](cli-protections-validation.md).

## Fence rollout

Main Worker **60678f89-9637-4b9c-8e69-e243e7ae4b8d** is deployed.
Vault remains **02dcb88b-5c99-49d9-a4b6-cb95451e6bb5**. Read-only production
verification shows `revisionTracking: "storage"`, a one-time advance from 2 to 3,
and the exact same three policy objects. All branch names/commit IDs match the
approved CLI test's pre-test snapshot. No new credential, Git push, review or
environment deployment was created for the fence rollout. No real legacy write
or production rollback was attempted; those cases have the real local Worker
and SQLite evidence above.

The published 0.4.5 manifest/module/checksum and isolated Bun installer pass
again against the new Worker. Both aliases and legacy routes retain their
behavior. Private metadata receipts:
`~/.config/nanohub/prod-validation-2026-10-27/protection-revision-fence.json` and
`~/.config/nanohub/prod-validation-2026-10-27/cli-distribution-release-0.4.5.json`.
The approved administrative credential remains revoked and its temporary input
is absent. Screenshots retain the completed [CLI audit](cli-protections-production-audit.png)
and [empty credential list](cli-protections-production-revoked.png).
