# Recovery readiness and controller receipts — 2026-10-30 JST

The recovery harness now handles explicit phase/startup refusals, verifies purge
readiness, serializes its receipts and runs fixture tests in the native CI graph.
**The complete hosted changing-Git rollback-and-return gate remains unpassed.**
The [sanitized receipt](recovery-readiness-receipt.json) distinguishes local
validation from three failed cloud attempts and independent cleanup.

## Observed failures

| Run | Source | Observed result |
| --- | --- | --- |
| `mvtmbj4l-74b7c2dc15` | `10b8d83` | Captured distinct Git points across 15 DO instances/ten classes, with 17 and 19 R2 objects. Corruption was rejected before loss. The loss phase's Git HEAD read then returned `503 fixture_frozen`, despite an earlier successful phase observation. Restore/return acceptance was not reached. Initial cleanup stopped at purge HTTP 409; supported cleanup resume completed. |
| `mvtnhtez-e6b1f34c7b` | `ebfa7f9` | Provisioning passed, but initial private health returned 404 before repository seeding. The new purge-readiness path completed cleanup automatically. |
| `mvtnt657-ec294d5a06` | `024e471` | Startup identity/expiry passed. An unknown transport failure during seeding stopped the run before checkpoints. Initial cleanup could not confirm Worker existence; supported cleanup resume completed after fresh provider observations. |

No failed attempt or successful cleanup is classified as recovery acceptance.
The first refusal establishes that one successful phase observation can precede
a later request reaching a frozen phase. It does not establish a global rollout
bound or explain the transport failures. Initial startup 404 responses did not
retain enough detail to distinguish routing from credential propagation.

Independent later reads confirm every generated API/gate/Vault Worker, R2 bucket,
D1 database and synthetic provider entry absent for all three runs. Explicit
nine-application-class and one-Vault-class retirement receipts are verified.
Private keys/grants are removed; original provider-entry IDs/names remain present.
Existing provider values are not resolved for this comparison. The account store
is not created or deleted by the harness.

Production main remains `857257c1-18fa-4866-87f8-2e9a9216bf20` at 100%; Vault
remains `02dcb88b-5c99-49d9-a4b6-cb95451e6bb5`. Fresh provider observations and a
Node public-version read agree before and after the attempts. An earlier public
preflight using Python urllib received HTTP 403, while Node received 200; its
cause is unestablished. No browser impersonation or credential substitution is
used to obtain the Node result. No production application resource is restored,
Git ref modified, request hold enabled or service redeployed in these drills.

## Corrections and boundaries

Private GET/HEAD retries are limited to the recognized `fixture_frozen` refusal,
with exact held-phase/version observation and receipt persistence before another
read. Transport exceptions, unknown status/body, wrong authority and failed proof
persistence stop. Writes are rejected by this read helper. Expected frozen checks
and existing rate-limit response bodies retain their original handling.

Startup uses bounded GET health observations and verifies both private fixture
identity and its exact configured expiry. A 404 cannot admit work or count as
absence. Wrong/denied/malformed successful responses and unknown transport errors
stop. No mutation is retried by the startup helper.

Authenticated purge status reports booleans only and never lists/deletes objects.
Purge requires its closed mode, no application binding and its owned bucket. Only
the precise pre-deletion refusal can retry, after another readiness proof and
within a three-POST bound. An actual socket reset after deletion is not replayed;
unknown/invalid acknowledgements retain cleanup responsibility.

Parallel read proofs previously could write the same receipt temporary path.
The controller now snapshots and queues writes. A failed write rejects its caller
without preventing a later cleanup receipt. Real concurrent HTTP reads verify
that each proof reaches disk before its retry and the final receipt retains all
eight proofs. This does not provide a cross-process lock.

Transport errors now identify known fixture HTTP operations and recognized
network codes, without copying raw credential/body/query/upstream-message data.
These diagnostics are locally tested; they do not retroactively identify the
third run's interrupted request or establish its retryability.

## Validation and CI

- `bun run test:hosted-recovery`: **86 cases pass under Bun**; the eight protocol
  cases also pass under **Node 24.14.1**, including real localhost HTTP, a socket
  reset after deletion and concurrent file persistence. Counts overlap.
- `bun run test:hosted-fixture`: **32 cases plus ten proxy/provider cases** pass;
  its Gate typecheck uses pinned tsrs. These overlap the recovery suite.
- `bun run --filter @swarm/api test:unit`: **365 pass**, including the actual
  workflow parser and stable dependency gate.
- `bun run check`: seven operator binding/syntax targets and all three workspace
  typecheck tasks pass; one workspace result is cached. This is not a fresh full
  project Linux acceptance for the final controller.
- `git diff --check` passes. No package dependency or lockfile changes are needed.

The workflow adds an independent `fixtures` job to the stable `check` dependencies;
the Linux toolchain verifier gains a corresponding ninth gate. Existing skipped
check semantics are preserved; success-only policy is required where skipped
dependent checks must block. This wiring is locally tested, not evidence of an
activated hosted dispatcher or a fresh nine-gate cloud run.

The final receipt/diagnostic/CI corrections have local acceptance. Another complete
isolated cloud drill is still required. Unknown restore-scheduling outcomes remain
fail-closed and are not retried. General production draining, independently retained
latest-authority acquisition, namespace-loss recovery, long-term backups and measured
RPO/RTO remain open alongside intended-application CI/staging and traffic acceptance.
Normal production remains on CLI 0.4.16. Source is locally committed, not pushed.
