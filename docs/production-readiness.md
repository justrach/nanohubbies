# Production readiness — 2026-10-28 (JST)

**Current recommendation: a controlled private beta with backup mirrors.**
The engineering estimate is roughly **70% toward the first production release**.
The acceptance evidence below determines release readiness; the percentage is
an informal assessment. Primary-host cutover for important repositories remains
pending the original migration and CI/staging acceptance.

| Area | Current evidence | Remaining release requirement |
| --- | --- | --- |
| Native Git hosting | Real private production push/clone/protection checks; lossless fixture refs, history, binaries, modes and tags; actual [complete Meld graph migration into a local Worker](evidence/initial-import-validation.md), with all 178 branches/18,097 objects and independent clone/fsck | Repeat actual application migration in an isolated hosted copy, verify resource capacity and preserve every committed asset/ref before cutover |
| Permissions, reviews and protections | Server-side roles, scoped credentials, current independent reviewers, hunk conversations, rulesets/locks, signatures, exact-candidate CI gates; [success-only acceptance](evidence/success-only-checks-validation.md) | Apply and verify the actual application's policy in its isolated copy; remaining GitHub compatibility gaps are explicit in the parity contract |
| Native CLI | Published 0.4.11; source and bundled Git/API administration tests, including revision-checked [deployment environment administration](evidence/cli-environments-validation.md) and owner-only [runner registration/recovery/revocation](evidence/cli-runners-validation.md); immutable download hashes | Broader command parity remains open; public release operations need the checks below |
| Cloudflare-owned secrets | Separate private on-demand vault, hosted synthetic lifecycle/retention/revocation; [access and secrets](access-and-secrets.md) | Actual runtime eviction remains platform-controlled; keep values in Cloudflare during recovery and never export them into repository backups |
| Codegraff Actions | Real disposable cloud job through the dispatcher; [retained private full image and separate fresh-VM acceptance](evidence/private-toolchain-registry-validation.md) passes every offline project gate using per-job temporary Cloudflare pull access; both VMs are confirmed destroyed | A sandbox-scoped Nanohub key, unattended dispatcher, repository registration, hosted callbacks and capacity/cleanup observation |
| Staging and application cutover | Exact candidate/version/approval/acceptance contracts and negative tests; committed Meld runbook/controller located through existing Git access, healthy controller and matching current staging version in [read-only discovery](evidence/meld-source-discovery.json) | Live intended-application staging job from Nanohub source, version checks before/after real-service acceptance, isolated PR-head Success, compliant and deliberately rejected merges; preserve current remotes until accepted |
| Recovery | [Local cold DO/D1/R2 loss-and-restore drill](evidence/cold-recovery-validation.md): exact Git and metadata, locks/reviews/archive fences, as-of-checkpoint revocations, retained separate provider values; older-backup authority resurrection demonstrated. An [operator request hold](evidence/recovery-hold-validation.md) is deployed, with normal assets and an isolated held configuration verified | Implement and run the [isolated hosted recovery workflow](recovery.md#hosted-recovery-release-gate), independent retained backups, complete isolation/draining and current-authority reconciliation before reopening; prove Cloudflare resource coverage and measured RPO/RTO |
| Traffic and operations | Atomic-write/race tests, runner pool concurrency and existing request/resource bounds | Sustained load against an agreed traffic target, abuse/security acceptance and operational monitoring/recovery evidence |
| Source and releases | Changes are committed locally and selected builds are deployed; source has not been pushed to GitHub | Source review/push and an automated repeatable release/rollback workflow |

Current local acceptance passes 294 API unit tests, 225 repository unit cases
and the full real Worker/Git acceptance chain, plus pinned
tsrs. The separate fresh Linux VM passes frozen offline install, all API and
repository gates, 47 CLI cases, access/vault, 37 hosting/pool cases, production build and
tsrs. The exact source, additional local assertions and limits are in the
[initial import evidence](evidence/initial-import-validation.md). The
[private registry evidence](evidence/private-toolchain-registry-validation.md)
records retained image distribution and its earlier full-project run.
Hosted reads prove
the current receiver and preservation of the private canary's refs and policy.
These establish specific paths and invariants; they do not establish a traffic
SLO or replace an end-to-end hosted CI/staging or disaster-recovery drill.

The current main Worker is `d8d8a177-a2db-469a-9b18-d6d630a0ade5`, with normal
traffic enabled and the request hold available but off. The request hold's first
corrected rollout was `1450c429-a969-483e-8383-c05d9ed8467c`. A first rollout exposed a static-asset delivery
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
The later environment CLI rollout also passes 15 exact asset checks, unchanged
27-binding metadata and nine exact canary state comparisons. It verifies public
CLI execution/help and production permission discovery without creating a
production credential or editing a production environment. The later runner
CLI rollout repeats 15 exact asset checks, 27 unchanged bindings and all nine
canary comparisons. It verifies the explicit owner-only scope is offered and
unchecked, without issuing a production runner credential or claiming hosted
callback acceptance. The configured Nanohub account key still lacks sandbox
scope; isolated cloud acceptance uses a separate existing CI credential.
The initial-import rollout retains the CLI bytes and all nine canary resources,
and confirms an explicit 50,000-subrequest budget in hosted version metadata.
The actual 178-branch Meld graph passes local complete migration and clone/fsck;
hosted large-graph acceptance and actual application CI/staging are still open.

The next release work should close unattended CI activation and hosted callbacks, actual
application staging acceptance, complete restore verification and traffic/security
operational validation. The [original issues](https://github.com/justrach/nanohubbies/issues/3)
retain their explicit cutover gates. Production remains separate from a verified
private-beta deployment, and the original repository must remain available.
