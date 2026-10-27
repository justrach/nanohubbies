# Native CLI protection management — 2026-10-27

## Delivered behavior

CLI 0.4.5 adds exact classic protection list/export/edit/delete. Reads use the
existing metadata permission. Changes require a separately requested
`protections:write` scope and a current repository admin/owner role. Existing
credentials gain no permissions, and default browser login does not request
administration. The grant cannot configure runners, secrets, collaborators or
rulesets and gives no Git push or browser-only bypass rights.

Exports carry the repository's protection revision. The final SQLite transaction
rejects stale If-Match revisions before storing a change and its actor,
before/after value and CLI credential ID. Browser edits advance the same
revision. Full replacements preserve ordinary validation and overlap semantics;
deletion requires an exact pattern, observed revision and matching confirmation.
Lost network responses are never automatically replayed. See
[commands and API contract](../hosting-cli.md#branch-protections-from-the-cli).

## Automated checks

- **226 API unit tests**, all pass, including four new delegation, migration,
  audit projection and mixed-version RPC cases.
- Full repository gate: **178 focused unit tests** and every smoke invocation
  pass, including native Git, conditional CLI edits, aliases, review/check gates,
  MCP and archive interruption recovery.
- CLI: **28 tests, 233 assertions**, all pass. The new cases cover exported
  revisions, exact Unicode/leading-dash patterns, explicit delete confirmation,
  file-envelope failures, no automatic mutation retries and unchanged default
  login permissions.
- Pinned tsrs: API, web, web Worker and vault pass. Final OpenNext build and
  `git diff --check` pass.

The real Worker/D1/SQLite/Bun smoke demonstrates manual and device grant checks,
reader/writer denial, current admin demotion, role changes before token issuance,
old-grant denial, browser edits invalidating exports and concurrent conditional
writers with exactly one successful commit. It verifies recorded CLI provenance,
unknown-field refusal, oversize/malformed UTF-8 files, archival, namespace aliases,
restart persistence, repository/origin binding and revocation.

A lock created by the actual CLI rejects a real ordinary Git push and HTTP
branch creation. Adding an exact unlocked rule does not waive an overlapping
wildcard lock. Removing only the wildcard through the CLI permits the new test
ref, at the same seed commit as unchanged main. All local credentials are
revoked; fixtures are disposed.

## Interface verification

The incumbent Paper UI adds one optional unchecked permission to manual CLI
credential creation, names its admin requirement and explains that protection
management can remove requirements. Explicitly requested device consent shows
the same permission and expiry. Authorization stays disabled until the terminal
code is confirmed. The synthetic preview request was denied without issuing a
credential. Its denial state receives keyboard focus.

The permission preview at 320 px has no horizontal document overflow. Text wraps
and existing theme, focus and control states are retained. No new visual world
or automated design detector result is claimed. Screenshots:
[manual permissions](cli-protections-local-permissions.png),
[mobile consent](cli-protections-local-mobile.png).

## Deployment and compatibility

Initial main Worker for CLI protection validation:
**086c3a3b-555e-4735-a9e3-97465c85a224**. The subsequent
[storage fence release](protection-revision-validation.md) records the current deployment.
Vault remains **02dcb88b-5c99-49d9-a4b6-cb95451e6bb5**.

The initial 69e74a1c rollout served the new CLI but the canary's Durable Object
did not yet expose the new RPC method. Cloudflare's API confirmed all bound
namespaces belong to nanohub-swarm, the current deployment was 100% on that
version and its deployed content included both method definitions. Cloudflare
documents that Workers and objects can temporarily run different code versions
during [eventually consistent code updates](https://developers.cloudflare.com/durable-objects/platform/known-issues/#code-updates).
These observations support a mixed-version diagnosis; they do not measure
propagation or prove a platform fault.

Compatibility handling now preserves legacy browser reads if the new method is
unavailable, without inventing a usable revision. Native CLI reads/edits then
return 503 with Retry-After. A conditional edit never falls back to the old
unconditional writer. Other storage errors remain errors. Both directions of
the normal method contract remain compatible with existing browser clients.
After the final full deployment, a production browser read returned the three
existing policies and numeric revision 0. The original Unicode lock, main
CODEOWNERS requirements and feature signature requirement remain stored.

## Published CLI and production test status

Published **0.4.5**, **39,890 bytes**, SHA-256
`46dc1a6253744b1097c0062f7a16a7dfcfd6de32aa2513a195f13c8c7aea3716`.
The actual manifest/module/checksum and published Bun installer pass in a private
temporary prefix containing spaces and an apostrophe. Both aliases work outside
the checkout, new rule commands appear in help, current Worker metadata matches,
and legacy routes/cache headers pass. No global installed command, PATH or Git
configuration changed. Private receipt:
`~/.config/nanohub/prod-validation-2026-10-27/cli-distribution-release-0.4.5.json`.

With explicit user approval, issued the prepared one-day credential with read
and protection management only, scoped to the existing private canary. The
actual published CLI passed list/export/set/delete against Worker 086c3a3b:
added only `cli-protection-smoke-20261027/**`, rejected the stale export, then
removed only that synthetic rule. Protection revision advanced from 0 to 2;
the original three policies, all refs, PR head and computed review gate remained
unchanged. Activity events #27 and #28 show the creation/deletion **via CLI**.

The script immediately revoked the credential and verified 401 from both
whoami and the protection endpoint. The temporary plaintext input was deleted,
the REPL token cleared, and Connect shows no active CLI credentials. No Git push
or review was submitted. Private metadata receipt:
`~/.config/nanohub/prod-validation-2026-10-27/cli-protections-smoke.json`.

Screenshots: [recorded CLI changes](cli-protections-production-audit.png),
[no active credentials](cli-protections-production-revoked.png).
The subsequent [storage revision fence](protection-revision-validation.md)
extends concurrency protection to older SQL writers and records its own checks.
