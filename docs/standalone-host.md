# Standalone Git hosting

Nanohub has two deliberately separate repository modes:

- **Source snapshot**: existing GitHub/agent imports retain filtered UTF-8 files and create a seed commit. This is an agent workspace, not a lossless migration.
- **Git repository**: preserves Git object bytes and IDs, commit ancestry, branches, annotated/lightweight tags, regular/executable files and symlinks. Normal pushes update refs without squashing or rebuilding commits. Git PR merges fast-forward to the reviewed, tested candidate, preserving binary changes, renames and file modes.

Sign in, open `/start`, and choose **Create an independent Git repository**. These repositories start private, with an owner boundary established before objects can be uploaded. They can subsequently use the existing Codegraff team authorization. Anonymous requests cannot retrieve their metadata, packs or loose objects. CI read credentials cannot push, change protections, submit reviews or access other workspaces.

## Migrate committed code

Create an empty Git repository. For ordinary clone/push, open **Git access** and
create a repository-scoped Git token; agent registration is optional. For a
large batch migration, register an optional `migration` agent under **Agent
collaboration** and issue its scoped credential. The batch object API currently
requires that automation credential. Keep it in `NANOHUB_TOKEN`; the migration
command never writes it to the remote URL or disk.

```sh
node tools/migrate-repository.mjs /absolute/path/to/source \
  https://nanohub.sh/git/my-repository.git migration
```

The source checkout is read-only: uncommitted edits and untracked files are excluded. The command pins the source branch/tag IDs, checks source integrity, uploads bounded compressed batches, then atomically publishes the refs only after the complete reachable graph validates. Finally it makes an independent mirror clone, runs `git fsck --strict`, and compares branch/tag IDs and branch trees/modes. Matching content-addressed objects establish matching file bytes, including runtime assets. A verification failure is not migration acceptance. The original repository remains available throughout.

Small repositories can also use ordinary `git push --mirror` into an empty Git repository. The streaming push limit is 32 MiB. Larger repositories use the batch migration tool. Existing refs are never overwritten by the migration tool. A partial object upload is safe to retry while the repository remains empty. Content-addressed packs are immutable; failed/unreferenced upload batches currently remain until the workspace is deleted.

Current boundaries:

| Setting | Default | Maximum |
| --- | ---: | ---: |
| `GIT_MAX_OBJECT_BYTES` | 16 MiB | 32 MiB |
| `GIT_MAX_EXPANDED_BYTES` per uploaded pack | 48 MiB | 64 MiB |
| `GIT_MAX_REPOSITORY_BYTES` per reachable graph | 2 GiB | 16 GiB |
| `GIT_MAX_OBJECTS` per graph/pack | 100,000 | 200,000 |

The bundled migration client uses 4 MiB expanded batches and a 16 MiB per-object limit. Server traversals may additionally hit platform request/resource limits on very large histories; failure does not publish refs. Ref names preserve UTF-8 and use a 255-byte complete-ref limit; up to 10,000 refs are supported. Create the destination with an initial `defaultBranch` that exists in the source; main is not required. Migration never renames or adds source branches. See [ref names](git-ref-names.md) and [default branches](default-branch.md). UTF-8 path names and directory depth up to 100 are supported. Unsupported names, malformed/corrupt objects, noncanonical trees, gitlinks/submodules and exceeded limits fail explicitly. Git LFS pointers fail explicitly because external LFS object transfer is not implemented. Do not claim a complete LFS or submodule asset migration. Binary previews are omitted; raw downloads and clones retain the original bytes. Text patch export rejects binary/mode changes and directs callers to Git clone/fetch or `git bundle`.

## Protect main

A signed-in repository owner or admin can `PUT /api/trunks/:trunk/protection` with a same-origin session:

```json
{
  "branch": "main",
  "pullRequest": true,
  "approvals": 1,
  "checks": ["codegraff-ci", "staging"],
  "beforeOpen": ["codegraff-ci", "staging"],
  "preventForce": true,
  "preventDelete": true,
  "dismissStaleReviews": true,
  "requireLastPushApproval": true
}
```

`GET /api/trunks/:trunk/protection` exposes the policy. Settings → Rules edits
the protections; the PR view shows blocked reasons, candidate/base SHAs and
staging evidence. Required approvals count distinct authenticated humans,
excluding the PR author and, under the strict default, latest reviewable pusher.
Agents can leave feedback but cannot supply independent approval. File or
comparison-base changes automatically dismiss strict approvals; metadata-only
commits preserve trusted tree-bound reviews. Explicit retention is available
separately from the latest-push requirement. Change requests remain blocking
until superseded or dismissed with a reason by an allowed human writer.
See [review protections](github-parity.md#stale-approvals-and-latest-push-review).
An agent-opened PR records the owning human as author to prevent approval through
a second identity of the same person.

The sequencer reads current rules, review verdicts, head/base IDs and required checks in the transaction that updates the actual target. Git branch/tag pushes, branch mutation APIs, agent submissions/retries and PR merges cannot skip it. An outstanding current change request blocks merge. Protected branch deletion and history rewrites are rejected. No administrative/agent merge bypass is provided; owner policy changes and Git updates are audited in sequencer storage. Git PRs may target any existing branch; its matching protections apply at merge.

Git mode accepts agent work through ordinary feature branches and PRs. Text/symbol submissions are rejected at the sequencer boundary so they cannot silently rebuild binary trees. Existing source-snapshot workspaces also enforce PR-only policies at that boundary. Required exact-candidate CI merges need Git mode; snapshot squash merges fail closed when required checks are configured.

When a PR target moves, integrate it locally into the feature branch with an ordinary merge or rebase and push the new candidate. The target’s current head must be an ancestor at final merge. CI runs against that exact candidate SHA and the observed current-default SHA, which supplies trusted workflows. The default need not be an ancestor when a PR targets another branch. The final merge fast-forwards the actual target to the tested candidate. Results against an old default or old head cannot satisfy the current gate. Merging a parent PR retargets its dependent PRs to that parent’s target. Legacy snapshot PRs retain their main-only landing path.

## Trusted runners and pre-PR staging

For the Meld cutover criteria, configure `successOnlyChecks: true` on each
applicable protection. This makes skipped/neutral required results block both
pre-PR and final merge gates; the ordinary default follows GitHub semantics.
See [required check conclusions](check-conclusions.md#success-only-migration-policy).

A human owner creates a runner with `POST /api/trunks/:trunk/ci/runners` (`{"name":"meld-staging"}`), receives its token once, and stores it in the runner secret store. `DELETE /api/trunks/:trunk/ci/:runnerId` revokes it. Ordinary agent and user tokens cannot submit trusted results.

Branch updates enqueue a durable event keyed by branch/head/base inside the ref transaction. Events exist before a PR exists: `beforeOpen` blocks PR creation until its named checks succeed. Run a scheduled/service worker that calls:

1. `POST /api/trunks/:trunk/ci/claim` with `Authorization: Bearer <runner token>`.
2. Clone the returned repository using the returned `nhread_` token, verify and check out exact `run.head`; retain `run.base` as the trusted workflow source. Final merge separately proves actual-target ancestry. The clone credential expires with its two-hour lease and cannot write.
3. `POST /api/trunks/:trunk/ci/runs/:id` with `{attempt, results, staging}` using the runner token.

Delivery is at least once. An expired lease can be reclaimed with a higher attempt and a new read token; old callbacks are rejected. Exactly repeated completion is idempotent; conflicting retries fail. Head changes supersede older runs, revoke their clone access and invalidate successful checks. Checks are bound to both exact head and exact base. Missing, failed, cancelled, running and superseded checks all block required gates.

`tools/ci-runner.mjs` is a single-event adapter suitable for a service or fleet dispatcher. Invoke it repeatedly from your service manager; a run without work returns `{"idle":true}`. The default execution backend now uses native Codegraff sandboxes; see [namespaces and Actions](./namespaces-and-actions.md). The explicit `backend: "docker"` compatibility mode keeps the CI token outside candidate execution and mounts the verified checkout read-only into a disposable Docker container, copies it into the container's private temporary workspace, and runs configured checks there. The sandbox has no external network (loopback still supports the browser preview). The trusted, digest-pinned toolchain image must include the public dependency cache for the committed lockfile; a missing dependency fails installation instead of opening network access to the runner or cloud metadata. Candidate code receives no CI token, clone token or deployment secrets. The host checkout passed to the staging adapter remains unchanged by check commands.

Copy `tools/meld-ci.example.json` to a trusted path outside the candidate checkout. It selects `tools/meld-staging-adapter.mjs`, which reuses the **existing** [Meld staging controller and runbook](https://github.com/yourmeld/meld2/blob/main/docs/staging-pipeline.md). The GitHub-hosted Actions workflow is retired. Current Codegraff jobs run the frozen Bun 1.4.2 install, pipeline regression checks, workspace `bun run check` (pinned tsrs), `bun run test`, React browser tests and the OpenNext production bundle. The old local `candidate/` prototype and historical Actions commands are not the current CI contract.

Read-only discovery on 2026-10-28 JST located the committed runbook and controller
source through existing Git credentials. The connected GitHub API returns 404,
but Git reads of both `yourmeld/meld2` and `justrach/meld2` succeed and expose the
same observed main/staging heads. The controller's committed policy still names
`yourmeld/meld2`; do not change the adapter target based on the alternate remote
name. The public controller health endpoint responds, and staging's short build
ID matches the observed staging head. The [discovery receipt](evidence/meld-source-discovery.json)
pins the source/configuration hashes and precise observation. This closes the
missing-runbook lookup, without establishing a Nanohub-source run, full-history
import, new deployment, real-service acceptance or cutover. No Meld refs,
credentials, runtime secrets or bindings were changed.

```sh
node --env-file=/absolute/private/staging-pipeline.env tools/ci-runner.mjs /etc/nanohub-ci/meld.json
```

Keep the existing `MELD_STAGING_CI_URL` / `PIPELINE_ADMIN_SECRET`, GitHub authentication and the new workspace-scoped `NANOHUB_CI_TOKEN` in the trusted control process/secret store. The adapter never reads secrets out of GitHub or copies deployment/runtime credentials into Nanohub. Its controller origin is pinned to `meld-staging-ci.phedayatnia.workers.dev`.

The control process clones **Nanohub** with the expiring read-only run credential, verifies the candidate and base ancestry, and pins its full SHA. The current Codegraff controller only accepts GitHub source, so the bridge publishes this identical commit to the existing private `yourmeld/meld2` repository as a CI transport mirror. GitHub does not choose the authoritative candidate; every returned controller SHA must match the pinned Nanohub SHA. This is a compatibility bridge and still depends on GitHub for CI transport. It does not remove the original repository or claim a GitHub-free CI execution path.

Ordinary branch events push an immutable `nanohub-ci/<event-id>` mirror and request **checks only** through `/check`. An ordinary contributor or agent cannot turn that event into a staging deployment. The existing staging controller releases deployment authority for trusted staging work, so a human owner must approve the exact Nanohub head/base before that path can be used:

- Review the candidate on the workspace's **Actions** list and choose **Approve staging**, or use `POST /api/trunks/:trunk/ci/approve` with `{ "runId": "..." }` and a same-origin owner session.
- Approval requeues that candidate, invalidates prior leases/results, and is audited. A changed head/base requires a fresh approval. Agents and ordinary team members cannot approve it.
- The approved adapter fetches GitHub's shared staging ref, proves it is an ancestor of the Nanohub candidate, and pushes with a normal fast-forward update. Divergence fails and requests a reviewed integration candidate in Nanohub; there is no force-push/reset path.
- The adapter reuses an existing matching controller job for idempotent delivery, or calls `/run`, which resolves the current staging head itself. Any returned unrelated SHA or checks-only job is rejected. Failed/superseded jobs and unfinished cleanup/reporting do not pass.

This supports the existing pre-PR deployment gate: branch checks and owner-approved staging can complete before a PR is created. `beforeOpen` still requires both `codegraff-ci` and `staging`. When staging diverges, integrate it into a new reviewed candidate first, push that candidate to Nanohub and rerun its checks/approval. The supported merge strategy deploys the **same full SHA as the eventual PR head**. A separate staging integration SHA is not silently substituted for a PR head; callers must use the reviewed integration candidate as the PR head in this mode. Record any earlier feature SHA and its additional staging changes in the handoff.

The wrapper waits for the actual exact-candidate deployment job, then checks staging `/api/version`. Meld currently exposes a seven-character `buildId`; compare that exact configured prefix, record `observedBuildId`, and keep the full tested candidate SHA separately. It checks the version again after collecting evidence to detect shared staging movement. Other adapters default to full 40-character version IDs.

Set `MELD_ACCEPTANCE_MODULE` to an absolute, trusted module outside candidate code that exports `accept(context)` and returns `{url, realService:true, before?, after?}[]`. Use it to collect applicable **real** staging auth/upload/persistence/search/AI evidence and matched Before/After UI evidence. Unit/browser fixtures remain mocked evidence. The bridge fails closed without this module; deployment/version success alone is insufficient. Evidence and logs must remain in approved private artifact storage. The run records commands, candidate/base, controller deploy run ID, observed build ID and evidence links. `completion.json` supports exact callback retry without redeployment after a network failure.

For other runners, the optional Docker path in `tools/ci-runner.mjs` runs configured commands in a disposable container with a digest-pinned toolchain, read-only source mount and no external network. The image must contain its locked dependency cache. Candidate code receives no control-process secrets. Each command has a bounded execution time and its container is removed. A generic trusted staging module can export `dispatch(context)`, `wait(runId, sha)` and `accept(context)` using the same exact-deployment/version/evidence contract. This optional path is not a replacement for Meld's existing Codegraff service.

Leases last two hours without heartbeat; longer runs expire and must be reclaimed. The live bridge still needs the runner registration/service configuration, the existing private controller credentials, and the real acceptance module. The changes here do not replace runtime secrets/bindings, apply database migrations, deploy production or change Meld's primary remote.

## Verification and cutover

```sh
bun install --frozen-lockfile
bun run check                 # pinned tsrs in API, web and Worker projects
bun run test:repository       # policy/CI/staging tests and real local Git round-trips
node packages/api/scripts/smoke-migration.ts /absolute/path/to/source
# Disk-conscious candidate-only validation; excludes historical side branches:
node packages/api/scripts/smoke-migration.ts /absolute/path/to/source --candidate
```

The local fixtures test real Git clone/push and local Worker/DO/R2/D1 behavior. The staging adapter tests use fixtures; these are not real-service staging acceptance. Before cutover, validate the complete private Meld copy on the deployed Nanohub host, compare its committed runtime files/assets and all branch/tag IDs with a fresh clone, require its independent review/CI/staging policy, execute real acceptance, and record the rollback remote. Keep the original GitHub repository and every local working tree intact. Change the primary remote only after those checks pass. Rollback is switching back to the retained original remote; keep post-cutover accepted commits recoverable with a mirror/bundle before doing so.

## Local verification receipt

On 2026-10-26, the representative fixture round-tripped private branches/tags, binary additions/replacements/deletions/renames, a file larger than 256 KiB, executable modes and a symlink. Its fresh clones passed strict Git verification. Agent submissions/retries, alternate landing refs, unauthorized policy/check/staging-approval writes, stale reviews/results and compliant protected merges were exercised. Existing team-authorization and stacked-PR smoke tests also passed.

The local Meld checkout's committed candidate `699f51dae6c459bf33e91ac2ba581a173d8aef60` round-tripped 1,796 reachable objects, two candidate refs and its 1,402 committed paths through an isolated local Worker. The verification clone matched refs/IDs, bytes and modes and passed `git fsck --strict`. Its uncommitted/untracked work was excluded. This was a **candidate-only local test**, not the latest GitHub main, all historical side branches, a live deployment or cutover acceptance. A larger 64-ref test transferred/validated 13,212 objects but its independent verification clone exhausted local disk; that full migration is not recorded as accepted. Git LFS/submodules remain explicitly unsupported.

Meld’s production/staging applications were not deployed by this work. Nanohub and its private vault service were deployed on 2026-10-26; see [production validation](evidence/production-validation-2026-10-26.md). The Codegraff controller health endpoint and existing staging version were read successfully. The bridge/controller dispatch, secret provisioning, real-service acceptance module and deployed Nanohub migration remain unverified until activation in the approved environment.

## Collaborators and separate secrets service

Direct repository invitations, reader/writer/admin roles, and the independently deployed Cloudflare Secrets Store service are documented in [access-and-secrets.md](./access-and-secrets.md). Open **People** for both management screens. Hosted provisioning and trusted workload wiring are separate activation steps.

Owner/repo storage addresses and native Codegraff Actions: [namespaces and Actions](./namespaces-and-actions.md).
