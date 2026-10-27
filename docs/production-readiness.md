# Production readiness — 2026-10-27

**Current recommendation: a controlled private beta with backup mirrors.**
The engineering estimate is roughly **70% toward the first production release**.
The acceptance evidence below determines release readiness; the percentage is
an informal assessment. Primary-host cutover for important repositories remains
pending the original migration and CI/staging acceptance.

| Area | Current evidence | Remaining release requirement |
| --- | --- | --- |
| Native Git hosting | Real private production push/clone/protection checks; lossless fixture refs, history, binaries, modes and tags; clone/fsck; [parity contract](github-parity.md) | Complete the intended application's private-copy migration and compare every committed asset/ref before cutover |
| Permissions, reviews and protections | Server-side roles, scoped credentials, current independent reviewers, hunk conversations, rulesets/locks, signatures, exact-candidate CI gates; [success-only acceptance](evidence/success-only-checks-validation.md) | Apply and verify the actual application's policy in its isolated copy; remaining GitHub compatibility gaps are explicit in the parity contract |
| Native CLI | Published 0.4.9; source and bundled Git/API administration tests; immutable download hashes; [default-branch acceptance](evidence/cli-default-branch-validation.md) | Broader command parity remains open; public release operations need the checks below |
| Cloudflare-owned secrets | Separate private on-demand vault, hosted synthetic lifecycle/retention/revocation; [access and secrets](access-and-secrets.md) | Actual runtime eviction remains platform-controlled; keep values in Cloudflare during recovery and never export them into repository backups |
| Codegraff Actions | Real disposable cloud job through the dispatcher; full offline Linux project gates on a build VM; [toolchain acceptance](evidence/codegraff-toolchain-validation.md) | Verified toolchain distribution, an unattended production dispatcher, repository-scoped registration, hosted callbacks, account capacity/cleanup observation |
| Staging and application cutover | Exact candidate/version/approval/acceptance contracts and negative tests | Live intended-application staging job, version checks before/after real-service acceptance, isolated PR-head Success, compliant and deliberately rejected merges; preserve current remotes until accepted |
| Recovery | [Local cold DO/D1/R2 loss-and-restore drill](evidence/cold-recovery-validation.md): exact Git and metadata, locks/reviews/archive fences, as-of-checkpoint revocations, retained separate provider values; older-backup authority resurrection demonstrated. An [operator request hold](evidence/recovery-hold-validation.md) is deployed, with normal assets and an isolated held configuration verified | Implement and run the [isolated hosted recovery workflow](recovery.md#hosted-recovery-release-gate), independent retained backups, complete isolation/draining and current-authority reconciliation before reopening; prove Cloudflare resource coverage and measured RPO/RTO |
| Traffic and operations | Atomic-write/race tests, runner pool concurrency and existing request/resource bounds | Sustained load against an agreed traffic target, abuse/security acceptance and operational monitoring/recovery evidence |

The latest complete local acceptance passes
270 API unit tests, 213 repository unit cases plus
the full real Worker/Git acceptance chain, 39 CLI tests, 28 hosting/pool tests,
access/vault integration, pinned tsrs and production builds. Hosted reads prove
the current receiver and preservation of the private canary's refs and policy.
These establish specific paths and invariants; they do not establish a traffic
SLO or replace an end-to-end hosted CI/staging or disaster-recovery drill.

The request hold is deployed on version `1450c429-a969-483e-8383-c05d9ed8467c`
with normal traffic enabled. A first rollout exposed a static-asset delivery
regression and was rolled back. The corrected Worker explicitly delegates
matching assets before Next, and the strengthened acceptance checks exact file
bytes and MIME types. A disposable corrected-build Worker passes 15 normal
asset checks and 27 held requests, including previously served assets. Both
temporary Workers are deleted and their absence confirmed. The corrected main
site passes those normal asset checks, styled UI inspection, immutable CLI
verification, unchanged binding metadata and eight exact private-canary state
comparisons. Subsequent complete normal regression commands pass after earlier
local Git connection failures; their underlying cause remains unestablished.
See the [precise evidence](evidence/recovery-hold-validation.md).

The next release work should close unattended CI/toolchain distribution, actual
application staging acceptance, complete restore verification and traffic/security
operational validation. The [original issues](https://github.com/justrach/nanohubbies/issues/3)
retain their explicit cutover gates. Production remains separate from a verified
private-beta deployment, and the original repository must remain available.
