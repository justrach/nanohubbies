# Requested reviewer storage and recovery — local validation

This extends [candidate 0.4.19 acceptance](review-requests-validation.md) with
persisted answer/revision tracking. This is the original local validation record;
[later release acceptance](review-requests-release-validation.md) covers frozen
Linux and the compatible Vault/API rollout. Neither establishes production
traffic readiness or full GitHub compatibility.

Previously, application code marked a reviewer request answered after inserting
the review. Rolling that code back could leave a waiting request even after an
independent review. The new storage hooks handle the actual SQLite insert used
by older receivers. Opaque request generations and a review-ID high-water mark
establish ordering independently of wall clocks. Request state, revision and
answer audit commit with the review; an audit failure rolls back that insert.
Requests remain advisory and do not replace merge-policy decisions.

Current local acceptance passes:

- **424 API unit tests**, including **14 request-store** and **3 receiver-route**
  cases. These cover old SQL writes, backward clocks, malformed/non-independent
  reviews, distinct accounts/PRs, legacy request normalization under both SQLite
  recursive-trigger modes, ABA/stale views, missing revision authority, bounded
  requests, exact-generation reconciliation and transactional repair failure.
- **317 repository unit tests and the complete Worker/Git integration chain**,
  including protections/locks, independent reviews, hunk conversations, native
  CLI, archive fences and cold recovery.
- Real local Worker legacy-write acceptance: pending requests answer through
  the pre-feature SQL insert, a missing answer hook repairs once with attributed
  audit, a change request still blocks merge, request metadata survives restart
  and physical DO/D1/R2 loss/restore, and a late answer-audit failure rolls back
  review/request/revision together. Legacy request rewrites get a fresh identity
  and cannot count historical reviews. Native refs are unchanged and a fresh
  clone passes `git fsck --strict`; the synthetic Git credential is revoked.
- Source, bundled and exact-distribution reviewer integrations. The exact
  candidate distribution also passes the deployment and secret-command
  integrations. Its version, byte count and hash are checked before execution.
- Pinned tsrs and operator checks, the full OpenNext build, and the main Worker
  deployment dry run. API/web check results are fresh; the unchanged Vault check
  is cached. No Worker or Vault configuration is changed.

The receiver-route cases reject older/incomplete capability reports with private
503 responses for reads and edits, before any edit RPC. Missing RPCs do not fall
back to an older writer. Compatible receivers receive authenticated identity,
the observed diff and revision; JSON cannot spoof authority or capabilities.
Real Worker integrations exercise the compatible route over HTTP.

The test-only legacy-write and fault endpoint lives in the isolated fixture
entrypoint. It is absent from the deployment bundle. This runs the historical
SQL write boundary in current local Workers; it is **not** a hosted deployment
or rolling upgrade of historical Worker versions.

Pending pre-receipt rows and untracked replacements start tracking future
reviews. Their historical ordering is ambiguous and is not inferred from
timestamps. Repair reconciles only when the exact retained request receipt can
prove a later review. A missing revision counter does not reset to zero. These
mechanisms do not protect against arbitrary privileged database rewriting or a
full backup that restores older authority; the independent-authority recovery
and reopen procedure still applies.

The CLI artifact stays **0.4.19**, 97,845 bytes, SHA-256
`e86b40b33b6b2a4483073083054bd7d4605e835672c0e8bc32c90ddba2f0195e`.
Local 0.4.17 and 0.4.18 release bytes/hashes are unchanged. No frontend or CLI
source changes accompany this storage correction. The earlier scoped visual
review remains historical evidence for that unchanged UI.

The [receipt](review-request-storage-receipt.json) records the exact runtime and
fixture hashes, validation log hashes and scope. Private logs retain the prior
intermediate attempts as well as final passing runs. At that observation,
Cloudflare authentication was expired; a same-scope browser renewal reached
sign-in but saved-password selection did not fill it. Those local checks created
no cloud sandbox, production credential or deployment and read no customer
secret value. The later release completes frozen Linux, disposable delivery
and compatible Vault-first rollout acceptance. Hosted historical-version rolling
checks, original staging/cutover, hosted dispatcher activation and production
recovery/load/operations requirements remain open.
