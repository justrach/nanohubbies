# Deployment CLI — local acceptance, 2026-10-30

This records the initial local candidate checkpoint. CLI 0.4.17 and its API were
subsequently published with [separate release acceptance](cli-deployments-release-validation.md).
The original local receipt and its then-current production observations below
remain historical evidence.

Source `969757d` adds `nh` / `nanohub` deployment list, view, request, approve and
reject commands behind independent request/reviewer permissions. The
[contract](../cli-deployments.md) documents current authority and retry behavior;
the [sanitized receipt](cli-deployments-receipt.json) records exact artifacts,
checks and release limits. **CLI 0.4.17 is a local candidate, not published.**

## Verified behavior

Real local Worker/D1/SQLite fixtures exercise ordinary authenticated Git pushes,
current native reader and connected Codegraff-member consent, and the actual Bun
CLI as source, a standalone bundle and the exact release module. The membership
provider and deployment reports are synthetic. No cloud sandbox or deployment
adapter runs for this feature.

The tests verify:

- Request and review scopes are independent and explicitly requested. Old
  PR-review/environment grants gain no approval rights. Reader review grants
  provide no content push, runner authorization or secret-value route.
- Current configured reviewers can act; self-approval is denied when configured.
  A reader's approval does not shorten an environment wait timer. A rejection
  terminates a run waiting on that request.
- `If-Match` binds decisions to the observed request revision. Simultaneous
  approvals from two different accounts using one revision yield exactly one
  HTTP 200 and one HTTP 412. Actor/credential JSON spoofing is rejected.
- Expired/revoked grants, wrong owners/scopes/repositories, removed members and
  unavailable connected-team membership fail at the final mutation, including
  direct fixture calls that bypass the outer HTTP access check.
- Connected Codegraff members use the provider's `member` role, mapped to writer
  authority by the final sequencer. A real connected-team request/approval passes;
  provider outage rejects both the HTTP request and direct mutation.
- Losing a review acknowledgement leaves one stored decision. Inspection and an
  exact retry do not add a review or audit event; conflicting repetition fails.
- Removing an already-approved reader prevents CI lease resumption. Current
  membership, attempt/source and environment authorization remain necessary.
  Authenticated synthetic deployment completion then permits the protected merge;
  approval alone does not satisfy its required deployment.
- Listing/pagination, read-only capability hints, browser/device consent,
  restart, repository aliases, archive fences, revocation, attributed audit and
  fresh real Git clone/fsck pass. Mixed sequencer receivers stop without falling
  back to browser mutation methods.

## Checks

| Check | Result |
| --- | --- |
| `bun run --filter @swarm/api test:unit` | 370 pass |
| `bun run --filter @nanohub/cli test` | 68 pass, including real HTTP installer and both aliases |
| `bun run --filter @swarm/api test:repository` | 283 unit cases and the complete Worker/Git integration chain pass at the committed implementation |
| `bun run --filter @swarm/api test:cli-deployments` | Five focused cases, source CLI and standalone bundle pass |
| `bun run --filter @swarm/api test:cli-deployment-distribution` | Exact release module passes the full new Worker/Git fixture |
| `bun run --filter @swarm/api test:access` | Eight unit cases and collaborator/Vault Worker checks pass |
| `bun run --filter @swarm/api test:hosting` | 55 unit cases and capacity/namespace Worker checks pass |
| Hosted fixture suites | 32 Bun/ten Node cases; recovery has 91 Bun/23 Node cases; pinned tsrs passes |
| `bun run check` | Seven operator targets and three workspace tasks pass; one workspace result is cached |
| Offline frozen install, workspace build, OpenNext build | Pass |
| `git diff --check` | Pass |

Counts overlap and are not a combined independent-test total. Local gate coverage
does not establish a frozen Linux/cloud acceptance. Logs are retained privately
with SHA-256 digests in the receipt. The successful repository run emits a
nonfatal RPC-disposal diagnostic and Wrangler environment warnings; the workspace
build also reports the CLI Turbo outputs warning. Their root causes are not
resolved by this feature, and the passing checks are not production load evidence.

The new focused tests run in the ordinary repository gate. After the build, the
native workflow and the Linux verifier also run the exact release-module check;
the verifier still has nine gates. Hosted dispatch is not activated by this wiring.

## Candidate and production observation

The candidate module is **85,565 bytes**, SHA-256
`44d029819890d81384324fa159cb4c471cfb3c36e8b61e6c313eb7d96738d579`.
The prior 0.4.16 module remains 81,369 bytes with its original digest
`c3f19c95d57ad22e5658c3dc53e837f68bb6af8e24467c9248cb589969f7a9b4`.

Four fresh public production GETs verify the live manifest, exact 0.4.16 module,
unchanged installer bytes and main-version endpoint. They still report main
`857257c1-18fa-4866-87f8-2e9a9216bf20` and published CLI 0.4.16. No production
credential is issued or production mutation performed. The new approval path has
not been deployed or tested against production; source is locally committed,
not pushed. All local fixture processes have completed and their fixtures close.

Frozen Linux and production API/CLI release verification remain next release
requirements. This work does not close the configured Nanohub Actions key-scope
blocker, activate unattended runners, execute Meld staging, or complete hosted
changing-Git recovery, cutover, traffic/security or operational acceptance.

A fresh configured-account preflight at `2026-10-30T02:53:47.130Z` returns HTTP
403 with `sandbox_scope_required`: one provider GET, zero Nanohub requests,
zero CI claims and zero sandbox allocations. No alternate account credential is
substituted for hosted activation.
