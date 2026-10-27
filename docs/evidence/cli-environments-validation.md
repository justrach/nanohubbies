# Deployment environment CLI acceptance

The [sanitized receipt](cli-environments-receipt.json) identifies the exact source,
runtime hashes, hosted version, public CLI hash and cleanup. CLI **0.4.10** is
published, with native `env list/view/export/create/update/delete`. It retains
the existing environment semantics and adds an explicit current-admin CLI
permission. [Usage and authority](../hosting-cli.md#deployment-environments)
describe the command/API contract.

## Implementation and local acceptance

Only an explicit `environments:write` credential for this repository can use the
gateway. Default login permissions, previously issued grants, Git/agent/CI
credentials and other administrative scopes acquire no permission. Browser
consent identifies reviewer, timer and source-rule administration. Environments
remain admin-managed; CI registration remains owner-only.

SQLite-backed global settings revisions fence exported configurations. Triggers
observe browser and legacy SQL writes, including ABA and delete/recreate. The
existing per-environment revision remains separate. Identical replacements are
no-ops. Final conditional writes independently recheck current admin membership,
reviewer eligibility, the revision and archive fence; successful edits retain
the delegating account and credential ID in activity. Mixed receivers return
503 instead of using an unconditional method.

Local acceptance passes **286 API unit cases**, **218 curated repository unit
cases and the complete real Worker/Git chain**, source and standalone CLI
environment integration, three-workspace pinned tsrs, production Next and full
OpenNext standalone builds, and Wrangler's dry run. The new tests exercise all
six commands, complete reviewer/self-review/timer/runner/branch-and-tag settings,
browser edits invalidating CLI exports, simultaneous same-revision writes,
no-op updates, unknown fields/sources/reviewers, ordinary-grant denial, current
admin demotion at gateway and final RPC, provider failure, archive locks and
read access, browser device consent/exchange demotion, namespace aliases,
restart, audit, revocation and real clone/fsck with unchanged refs. The
environment grant cannot administer rulesets, runners or secret values.

## Separate fresh Linux VM

Clean private source snapshot
`dfac6cbca7df828f28d80407933c4a226980df9f` runs the actual verifier against
the retained private Cloudflare image. A new VM obtains temporary pull-only
access, prepares the pinned image and removes authentication before source
transfer. The candidate has no control keys or Docker socket, uses Bun 1.4.4
and Node 24.14.1, has no npm/npx and runs with networking disabled.

Frozen offline install, API unit tests, the entire real Worker/Git repository
chain (including source and standalone environment CLI), **42 CLI cases**,
access/vault, hosting/pool, production Next build and pinned tsrs all pass.
Every gate marker and `NANOHUB_FULL_LINUX_PASS` are retained. The actual runtime
files published in this release match that executed snapshot by SHA-256.
Additional HTTP assertions for archive reads and unrelated-scope denial were
then added to the fixture and passed locally; no runtime code changed afterward.
The VM is confirmed destroyed by the verifier and an independent provider read.
No hosted Nanohub runner registration or callback is involved.

## Production rollout and precise scope

Main Worker version `0fc3b30a-50a2-4cff-acf5-5d972db04320` serves CLI 0.4.10.
The public manifest and module bytes match the build, and the identical module
executes outside the checkout with the correct version and environment commands
in help. Fifteen real assets match exact build bytes; CSS, JavaScript and JSON
MIME types are verified. Immutable 0.4.8 and 0.4.9 releases retain their bytes.
All **27 binding metadata entries are unchanged**, Worker-first routing remains
enabled and the operator recovery hold remains off.

Signed-in browser reads before and after rollout match exactly for nine private
canary resources: branches (including review/Actions state), classic protections,
rulesets, default branch, archive state, environments, collaborators, secret
metadata and runner registrations. Current production permission discovery
offers `environments:write` to the admin. The deployed form renders it enabled
and **unchecked**, with no active CLI credentials. No token, environment policy,
review, ref or permission grant is created or changed during these production
checks. The [screenshot](cli-environments-production.png) records the visible
unchecked control. The temporary browser tab is closed.

Production acceptance here is **publication, read-only state preservation and
permission discovery**. It does not claim a live production environment edit
through a newly issued CLI credential; mutation coverage is the real isolated
Worker/D1/DO fixture and its separate Linux run. No vault deployment or GitHub
push occurs. The latest read-only Nanohub key check still returns sandbox-scope
403 without allocating anything. Unattended hosted Actions, actual application
migration/staging, hosted recovery and traffic/security operations remain open.
