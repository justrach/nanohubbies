# Production readiness — 2026-10-29 (JST)

**Current recommendation: a controlled private beta with backup mirrors.**
The engineering estimate is roughly **70% toward the first production release**.
The acceptance evidence below determines release readiness; the percentage is
an informal assessment. Primary-host cutover for important repositories remains
pending the original migration and CI/staging acceptance.

| Area                                 | Current evidence                                                                                                                                                                                                                                                                                                                                                                                          | Remaining release requirement                                                                                                                                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Git hosting                   | Real private production push/clone/protection checks; lossless fixture refs, history, binaries, modes and tags; actual [agent-free Meld graph migration through the packaged CLI](evidence/cli-import-validation.md), with all 178 branches/18,097 objects, independent clone/fsck and verification-only recovery                                                                                         | The [pinned hosted full-graph copy](evidence/hosted-import-validation.md) passes; the correction is [validated and deployed](evidence/pack-scan-release-validation.md); complete actual application policy/CI, capacity and cutover acceptance                                |
| Permissions, reviews and protections | Server-side roles, scoped credentials, current independent reviewers, hunk conversations, rulesets/locks, signatures, exact-candidate CI gates; [success-only acceptance](evidence/success-only-checks-validation.md)                                                                                                                                                                                     | Apply and verify the actual application's policy in its isolated copy; remaining GitHub compatibility gaps are explicit in the parity contract                                                                                                                                |
| Native CLI                           | Published [0.4.17](evidence/cli-deployments-release-validation.md), including deployment requests/reviews and scoped collaborator administration, private CLI batch reviews and merge/squash/rebase; [agent-free complete import and recovery](evidence/cli-import-validation.md), source and bundled Git/API administration, revision-checked [environments](evidence/cli-environments-validation.md) and owner-only [runner registration/recovery/revocation](evidence/cli-runners-validation.md); immutable download hashes                                                               | Broader command parity remains open; public release operations need the checks below                                                                                                                                                                                          |
| Cloudflare-owned secrets             | Separate private on-demand vault, hosted synthetic lifecycle/retention/revocation; [access and secrets](access-and-secrets.md)                                                                                                                                                                                                                                                                            | Actual runtime eviction remains platform-controlled; keep values in Cloudflare during recovery and never export them into repository backups                                                                                                                                  |
| Codegraff Actions                    | Real disposable cloud job through the dispatcher; [retained private full image and separate fresh-VM acceptance](evidence/private-toolchain-registry-validation.md) passes every offline project gate using per-job temporary Cloudflare pull access; both VMs are confirmed destroyed                                                                                                                    | A sandbox-scoped Nanohub key, unattended dispatcher, repository registration, hosted callbacks and capacity/cleanup observation                                                                                                                                               |
| Staging and application cutover      | Exact candidate/version/approval/acceptance contracts and negative tests; committed Meld runbook/controller located through existing Git access, healthy controller and matching current staging version in [read-only discovery](evidence/meld-source-discovery.json)                                                                                                                                    | Live intended-application staging job from Nanohub source, version checks before/after real-service acceptance, isolated PR-head Success, compliant and deliberately rejected merges; preserve current remotes until accepted                                                 |
| Recovery                             | [Local cold DO/D1/R2 loss-and-restore drill](evidence/cold-recovery-validation.md): exact Git and metadata, locks/reviews/archive fences, as-of-checkpoint revocations, retained separate provider values; older-backup authority resurrection demonstrated. The [native hosted probe](evidence/native-recovery-validation.md) passes; the [repository drill](evidence/hosted-repository-recovery-validation.md) passes, and the [Vault-inclusive extension](evidence/hosted-vault-recovery-validation.md) now restores 15 instances across ten classes, retains the latest provider value, denies revoked workload access after restart and leaves no idle Vault alarm; normal traffic stays held | Complete the [production recovery workflow](recovery.md#hosted-recovery-release-gate): complete changing-Git rollback-and-return acceptance (newer and older clone/fsck plus revocation reconciliation pass; the final newer return stopped on an unknown restore-request connection reset; failed-run cleanup is independently verified), retained long-term backups, production inventory/isolation/draining, independent latest-authority acquisition, namespace-loss recovery and measured RPO/RTO before safe reopening |
| Traffic and operations               | Atomic-write/race tests, runner pool concurrency and existing request/resource bounds                                                                                                                                                                                                                                                                                                                     | Sustained load against an agreed traffic target, abuse/security acceptance and operational monitoring/recovery evidence                                                                                                                                                       |
| Source and releases                  | Changes are committed locally and selected builds are deployed; source has not been pushed to GitHub                                                                                                                                                                                                                                                                                                      | Source review/push and an automated repeatable release/rollback workflow                                                                                                                                                                                                      |

The [hosted migration check](evidence/hosted-import-validation.md) exposed a
publication timeout after uploading the full actual graph. A bounded pack-cache
correction now passes complete hosted import, independent clone/fsck,
verification-only resume and revocation on the pinned 178-branch/18,097-object
Meld graph. Independent cleanup confirms namespace retirement and absence of
all test resources. The correction now passes fresh Linux validation and is
[deployed](evidence/pack-scan-release-validation.md). Its local acceptance passes 314 API unit tests,
245 repository unit cases, the full Worker/Git/protection/recovery chain, 48 CLI
tests, pinned tsrs and OpenNext build. The fresh Linux VM passes all eight
release gates, with independent destruction confirmation and all 908 frozen
source files matching the rollout. Fifteen live asset checks, 27 unchanged
bindings and nine exact authenticated canary comparisons pass. The main site's
earlier implementation has the historical acceptance evidence below.

That earlier local acceptance passes 297 API unit tests, 228 repository unit cases
and the full real Worker/Git acceptance chain, plus pinned
tsrs. The separate fresh Linux VM passes frozen offline install, all API and
repository gates, 47 CLI cases, access/vault, 37 hosting/pool cases, production build and
tsrs. The exact source, additional local assertions and limits are in the
[native import evidence](evidence/cli-import-validation.md). The
[private registry evidence](evidence/private-toolchain-registry-validation.md)
records retained image distribution and its earlier full-project run.
Hosted reads prove
the current receiver and preservation of the private canary's refs and policy.
These establish specific paths and invariants; they do not establish a traffic
SLO or replace an end-to-end hosted CI/staging or disaster-recovery drill.

The current main Worker is `a37ab061-a029-4480-9fb9-2b7cefeb19e3`, with normal
traffic enabled and the request hold off. CLI 0.4.17 is published. The
[deployment CLI release](evidence/cli-deployments-release-validation.md) passes
all nine frozen Linux gates, including the exact release artifact, 26 exact
public asset checks, both installed aliases, nine canary comparisons and
unchecked request/reviewer consent. All 27 bindings remain unchanged; Vault is
not redeployed. An inactive held version retains the deployment enforcement.

The preceding main Worker was `857257c1-18fa-4866-87f8-2e9a9216bf20`. Its
[access/capacity release](evidence/access-capacity-release-validation.md) passes
all eight frozen Linux gates, 25 exact public asset checks, installation/execution
of both aliases, nine exact canary comparisons and explicit unchecked collaborator
consent. Its shared capacity API is deployed; hosted dispatch is not activated.
All 27 bindings remain unchanged, Vault is not redeployed, and an inactive held
version retains the new enforcement.

Before that, the main Worker was `31d951d3-6a6d-4784-aeaf-34c39995733b`. Its
[merge-settings release](evidence/merge-settings-release-validation.md) passes
all eight frozen Linux gates, 24 exact live asset checks and nine canary state
comparisons. Live UI save/readback and archive-fence checks pass in a separate
private synthetic repository, retained archived with no Git or CLI credentials.
All 27 bindings and the request budget remain unchanged; Vault is not redeployed.
An inactive held version retains merge-setting enforcement for operator fencing.

Before the merge-settings release, the main Worker was `c5be9de5-8aa1-4a54-bcd9-5f4e067a542a`.
The [merge-method release](evidence/merge-methods-release-validation.md) passes
all eight frozen Linux gates, the full local Worker/Git acceptance chain, 330 API
unit cases, 261 repository cases and 53 CLI cases. Fifteen live asset checks,
27 preserved bindings and nine authenticated canary comparisons pass. The
configured Nanohub Actions account last returned HTTP 403 for missing sandbox
scope; separate CI-account acceptance does not activate its hosted dispatcher.
The trusted dispatcher now [checks sandbox access before claiming candidates](evidence/runner-preflight-validation.md).
Live rejection with that configured key makes zero Nanohub requests; real
Worker integration proves queued candidates and attempts remain unchanged.
This correction passes 340 API unit cases, 264 repository cases and the full
Worker/Git acceptance chain, plus hosting integration and pinned tsrs.

Deployed [repository merge settings](merge-settings.md) extend the UI, final
writer and CLI 0.4.15. Their [local acceptance](evidence/merge-settings-validation.md)
passes 348 API unit cases, 272 repository cases with the full Worker/Git chain,
59 CLI cases, pinned tsrs and the Next/OpenNext production build. Latest reader
permission hints are additionally verified by source and packaged Worker tests.
The [release acceptance](evidence/merge-settings-release-validation.md) adds
frozen Linux and hosted verification. Source remains unpushed. A fresh
2026-10-29 read of the configured Nanohub Actions key still returns 403 for
missing sandbox scope, with zero claims or allocations. The operational release
requirements above remain open.

The earlier main Worker was `993b659a-8d24-442b-92b4-f5270a94029a`. The request hold's first
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
at that rollout, hosted large-graph acceptance and actual application CI/staging remained open. The later isolated pack-cache candidate closes the pinned hosted graph gate; actual application CI/staging remains open.
The native import rollout publishes CLI 0.4.12, repeats the fifteen asset and
nine canary comparisons, and retains all bindings/budgets. An initial provider
429 allocation attempt is followed by a successful fresh-VM eight-gate run and
confirmed cleanup. The exact packaged CLI also passes the actual local Meld
import/resume/revocation sequence with zero registered agents. Production
verification remains publication and preservation, without a new import grant.

The next release work should close unattended CI activation and hosted callbacks, actual
application staging acceptance, complete restore verification and traffic/security
operational validation. The [original issues](https://github.com/justrach/nanohubbies/issues/3)
retain their explicit cutover gates. Production remains separate from a verified
private-beta deployment, and the original repository must remain available.

Shared Actions capacity now has [local acceptance](evidence/actions-capacity-validation.md):
one durable deployment/account reservation ledger across controllers, retained
slots for uncertain allocations or failed cleanup, and scoped operator recovery.
The API is deployed with [release acceptance](evidence/access-capacity-release-validation.md).
Hosted dispatch is not activated, and the existing Actions key-scope blocker
remains. Account-specific compute/pricing tiers, spend limits, hosted
activation and production capacity/load acceptance remain open.

Published CLI 0.4.16 also adds [collaborator administration acceptance](evidence/cli-collaborators-validation.md):
separate explicit admin delegation, private recoverable invitations, conditional
role/removal/cancel operations and immediate role enforcement on later requests.
The [published release](evidence/access-capacity-release-validation.md) adds
frozen Linux and live delivery/consent/preservation checks. This does not close
hosted activation, staging, recovery or traffic-readiness gates.

The [recovery-controller readiness checks](evidence/recovery-readiness-validation.md)
add bounded fixture phase/startup observations, guarded purge readiness, serialized
receipts and a native CI fixture gate. Three further isolated cloud attempts fail
before complete restore/return acceptance; all are independently confirmed cleaned,
with production versions unchanged. Local harness checks do not close the hosted
changing-Git recovery gate or constitute a fresh nine-gate Linux acceptance.

A [subsequent hosted attempt](evidence/recovery-upload-uncertainty-validation.md)
captures the first checkpoint and verifies synthetic revocations/provider rotation,
but Cloudflare code `100312` stops the next phase upload before a second checkpoint
or restore. Independent cleanup and unchanged production versions pass. The
follow-up diagnostic is locally validated and preserves the stop-on-uncertainty
rule; full hosted recovery remains unpassed.

The published [deployment CLI](evidence/cli-deployments-release-validation.md) adds scoped
requests and approvals/rejections, including configured reader and connected-team
reviewers. Local Worker/Git, source/bundled/exact-module, all nine frozen Linux
gates, public installation and production consent/preservation checks pass for
0.4.17. The initial clean-checkout fixture failure is retained alongside its
correction and successful fresh run. This does not activate hosted runners or
complete actual application staging/cutover or hosted changing-Git recovery.
