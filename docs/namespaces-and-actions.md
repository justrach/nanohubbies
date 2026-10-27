# Owner/repo storage and Codegraff Actions

This adds GitHub-style repository addressing and a native Codegraff execution backend. The namespace APIs are deployed. A real Codegraff dispatch passes against an isolated local Nanohub repository. The full project toolchain is retained privately in Cloudflare's managed registry; the unattended production dispatcher still needs activation. The new backend does not use GitHub as a source or transport mirror.

## Repository model

A signed-in account claims one personal owner handle. Repositories have case-insensitive `owner/name` addresses (canonical lowercase), with names unique **within that owner**. Two owners can both have `app`. Direct collaborators retain the reader/writer/admin roles described in [access-and-secrets.md](./access-and-secrets.md).

```text
owner/repo address ──→ immutable repository ID
                        ├─ Git commit/tree/blob/tag objects and pack/index files in R2
                        ├─ branches, tags, policies, PRs and CI in the repository's Sequencer
                        ├─ membership and invitations in Hub
                        ├─ private Actions logs in R2
                        └─ encrypted secrets by repository ID + environment in the separate vault
```

This uses standard Git objects and refs, with complete binary trees, hashes and modes. It describes a GitHub-style public repository model; it does not claim to reproduce GitHub's private physical storage implementation.

Create a repository using **Create an independent Git repository** on Start. Choose your owner handle and repository name. An existing independently managed private workspace can be given an address from **People → Repository address**. Rename there as well. The ID, Git objects, collaborators, secrets, policy, CI history and logs stay put. Old clone/API addresses remain aliases to the same ID. Renaming back to an alias of that same repository is supported. Addresses of deleted/failed initializations are retained, preventing an old clone URL from silently acquiring a different owner or codebase.

- Web entry: `https://nanohub.sh/alice/app` (opens its existing workspace pages).
- Git: `https://nanohub.sh/git/alice/app.git`.
- API: `https://nanohub.sh/api/repos/alice/app` and nested `/branches`, `/pulls`, `/collaborators`, `/secrets`, `/ci`, etc.
- Existing `/t/:id`, `/git/:id.git` and `/api/trunks/:id` remain compatible.

All names resolve to the immutable ID **before** checking membership, agent tokens, CI read leases or accessing storage. A token for another repo does not become valid because the repositories share a name. Personal owner handles and repository names have explicit limits; organization accounts, namespace transfers and cross-owner repository transfers are not implemented. The initial default is `main` unless a different `defaultBranch` is supplied. Owners/admins can select an existing branch under Settings; see [default branches](default-branch.md).

API management uses a same-origin human owner session:

```text
POST /api/namespaces                        {name: "alice"}
GET  /api/namespaces                        your namespace
GET  /api/namespaces/alice                  public handle-existence check
POST /api/repos/alice/app                   create an empty private Git repository
GET  /api/repos/alice/app                   ID and canonical URLs, current membership required
POST /api/repos/alice/app/address           {name: "new-name"}
POST /api/repository-addresses/:existingId  {namespace: "alice", name: "app"}
```

Creation reserves the address before dispatching initialization. An interrupted initialization retains its reservation for inspection rather than opening it to another repository. Namespaces have a 100-address cap, including retained reservations; existing deployment/creator quotas still apply to initialization.

The migration tool accepts both forms of Git URL and independently verifies the destination:

```sh
# Set NANOHUB_TOKEN privately to your registered migration credential first.
node tools/migrate-repository.mjs /absolute/source https://nanohub.sh/git/alice/app.git migration
```

## Actions backend

The trusted dispatcher claims Nanohub's durable CI queue, clones directly from Nanohub with an expiring read-only lease and verifies the exact head/base. Branch pushes, including the selected default branch, enqueue runs. A run can exist before a PR is opened. Protected PR gates continue to bind checks to the exact candidate and base. Ordinary required checks accept success, neutral or skipped conclusions; source pins and verified deployment requirements still apply. See [terminal conclusions](check-conclusions.md).

The default execution backend is now **Codegraff**. This repository’s own check workflow targets `runs-on: codegraff`, without GitHub-hosted runner dispatch. For every workflow job the dispatcher creates a fresh sized fleet sandbox, waits for readiness, uploads a credential-free Git bundle and runs the job there in a digest-pinned toolchain container. It polls completion through sandbox control commands, saves private logs and reports the check to Nanohub. A failed dependency skips its dependent jobs. A revoked/superseded lease cancels execution at the next lease check. Finally it destroys the sandbox and confirms an absent/destroyed/deleted/expired record before clearing the cleanup receipt. A stopped or running VM is not treated as deleted; cleanup failures fail the job and retain a receipt for recovery.

Codegraff supplies the VM and Docker runtime through its documented [sandbox gateway](https://codegraff.com/docs/sandboxes). Local Docker is unnecessary for this backend. The small dispatcher process still needs Git and Node, and holds `CODEGRAFF_API_KEY` and `NANOHUB_CI_TOKEN` outside candidate execution. Neither key, the clone lease nor vault workload grants are uploaded to the sandbox. The bundle contains committed Git data, excluding local files and clone configuration/credentials.

### Supported workflow syntax

Workflows live in `.github/workflows/*.yml` or `.yaml`, following the [Actions workflow convention](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax). This is an explicit subset, not a complete GitHub Actions runtime.

Supported: `on: push` (string/list/mapping), push `branches`/`branches-ignore` with simple globs, literal string `env`, `permissions: {contents: read}` or `{}`, jobs, `needs`, `runs-on: codegraff` or `ubuntu-latest`, 1–45 minute job timeouts, shell `run` steps, `bash`/`sh`, relative working directories, built-in checkout and Node version checks. A workflow may also list unfiltered `pull_request` alongside `push`, but the current dispatcher runs branch-push events, **not a separate PR event**.

- `actions/checkout@v4/v5` or a full SHA verifies the already checked-out candidate. No credential persistence, checkout-ref override or shallow history. If specifying `fetch-depth`, use `0`.
- `actions/setup-node@v4/v5/v6` or a full SHA verifies the Node version already in the pinned image. It does not install Node or implement dependency caching; omit `cache` and supply the correct trusted image.
- `ubuntu-latest` selects the configured Codegraff toolchain image; it does not claim to be GitHub's hosted image.
- Check names are stable `workflow-file/job-id`, e.g. `check/test`; configure required checks using these names.

Unsupported expressions, arbitrary marketplace actions, matrices, services, reusable workflows, schedule/dispatch events, automatic secrets interpolation, artifacts/cache actions, job outputs and other unsupported fields fail with an explicit error. Nothing silently grants write permissions or skips unsupported requirements. Runs support at most 29 jobs, 16 workflows, 100 steps/job, a 64 KiB workflow, and a 64 MiB compressed candidate bundle. Independent jobs execute concurrently; `needs` waits for prerequisites and cancels dependent jobs when a prerequisite fails. Each actual job gets a separate VM.

The dispatcher loads workflow definitions from `run.base`, the accepted default-branch commit observed when the event was queued. A candidate cannot replace a required job with a passing placeholder before review. For a default-branch push, the just-accepted default commit supplies the workflow. Bootstrap the first workflow in the selected default, then push a feature branch. Changes to workflow definitions take effect after they are accepted into the default. An existing PR may target another branch; its final merge must contain that target’s current head, while workflow trust and CI evidence still bind to the current default commit. Selecting a different default supersedes older-base work and queues current heads against the new workflow base.

Example:

```yaml
name: Checks
on: push
permissions:
  contents: read
jobs:
  test:
    runs-on: codegraff
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: bun run test
  build:
    runs-on: codegraff
    needs: test
    steps:
      - run: bun run build
```

The configured pinned image must provide Bash, Git, Node, Bun and the project's toolchain/dependency cache. `tools/codegraff/Dockerfile` provides digest-pinned Bun 1.4.4 and Node 24.14.1 toolchains and prewarms this repository’s exact `bun.lock`. Its base is digest-pinned and its Dockerfile-specific context allowlist includes only package manifests. Build/publish it for the target fleet architecture, then set the resulting immutable image digest in the dispatcher config:

```sh
docker buildx build --platform linux/amd64 -f tools/codegraff/Dockerfile -t ghcr.io/YOUR-ORG/nanohub-ci:YOUR-REV --push .
# Use the resulting ghcr.io/...@sha256:... reference, not the mutable tag.
```

The actual Linux image build and full offline project gates pass on a real Codegraff VM; see [toolchain acceptance](evidence/codegraff-toolchain-validation.md). A subsequent full image is published privately in Cloudflare's registry. [Private registry delivery](private-toolchain-registry.md) renews pull-only access per job, removes it before source transfer and verifies the pinned manifest digest. Rebuild its public dependency cache when the lockfile changes. Other repositories should supply their own verified toolchain/cache image. `prepare` runs before each job's steps. Networking defaults to `none`; use a prewarmed offline dependency cache or deliberately configure `network: "bridge"` for dependency downloads. No host credentials or Docker socket are mounted in the candidate container.

An explicit [HTTPS archive delivery mode](toolchain-archives.md) can instead
download and verify a saved image before candidate upload. It pins both archive
bytes and the Docker config ID, refuses redirects and keeps private URLs out of
candidate logs/receipts. A fresh-VM synthetic probe passes; retained full-image
distribution, URL renewal and actual full-project acceptance through that path
remain open. This does not activate an unattended dispatcher.

### Dispatcher activation

1. Deploy the application changes. Create the private named Git repo and push its main/workflow history. As the owner, authorize the explicit CLI `runners:write` scope and use `nh runner create NAME --token-file /absolute/private/repository-runner.json -R owner/repository`. Create the private parent directory first; keep it outside Git checkouts. The file is saved before registration and can recover a lost acknowledgement with `nh runner recover`. Alternatively create the credential under **Actions** and store it as `NANOHUB_CI_TOKEN`. Keep the Codegraff API key with the `sandbox` scope in the trusted dispatcher's secret store.
2. Copy `tools/codegraff-actions.example.json` outside the candidate checkout. Set its absolute `runnerCredentialFile`, canonical owner/repo, account namespace and verified registry SHA-256 digest. For an environment-stored credential, remove `runnerCredentialFile` and configure `tokenEnv` instead. Its `imageRegistry` config names the trusted host's Wrangler configuration; provision existing Cloudflare authentication there. For a public registry image, remove `imageRegistry`. Use a private artifact directory for receipts and completion recovery files.
3. From a trusted deployment of these tools, drain available work or run a long-lived dispatcher:

   ```sh
   bun --env-file=/absolute/private/nanohub-actions.env tools/ci-runner.mjs /etc/nanohub/actions.json
   bun --env-file=/absolute/private/nanohub-actions.env tools/ci-runner.mjs /etc/nanohub/actions.json --watch
   ```

The `--watch` process polls idle queues every five seconds. It does not install a system service or schedule a Codex automation. Run it under your existing service manager. CI leases last two hours; job deadlines are also capped by the remaining lease. The sandbox lease bounds abandoned allocations. Each job receipt records the sandbox ID and `cleanupNeeded`; an operator can retry `DELETE /v1/sandboxes/:id` with the trusted gateway key after a controller crash or failed cleanup. Explicit capacity/preparation responses (429/503) retry within the allocation deadline; ambiguous timeouts do not retry creation automatically. SIGINT/SIGTERM stops claiming and drains in-flight jobs through cleanup.

### Shared Nanohub account pool

There is no one-runner-per-repository restriction. Several worker processes may
share one repository registration, or use separate registrations for independent
revocation. The sequencer atomically leases each candidate to one attempt. The
200-run Actions display window does not limit queue processing or required-check
lookups. Revoking a registration immediately invalidates its read leases and
requeues its in-flight candidates for another worker; old attempts cannot report.

For one Codegraff account serving several repositories, copy
`tools/actions-pool.example.json` to the trusted host. Keep the shared
`CODEGRAFF_API_KEY` there and provide a different repository-scoped private
credential file for each target:

```json
{
  "origin": "https://nanohub.sh",
  "backend": "codegraff",
  "image": "registry.cloudflare.com/YOUR-ACCOUNT/nanohub-ci@sha256:VERIFIED_DIGEST",
  "imageRegistry": { "provider": "cloudflare", "config": "/etc/nanohub/wrangler.jsonc" },
  "artifacts": "/var/lib/nanohub-ci/private-artifacts",
  "concurrency": 8,
  "maxSandboxes": 16,
  "jobConcurrency": 4,
  "repositories": [
    { "repository": "nanohub/app", "runnerCredentialFile": "/etc/nanohub/private/app-runner.json" },
    { "repository": "nanohub/api", "runnerCredentialFile": "/etc/nanohub/private/api-runner.json" }
  ]
}
```

`concurrency` is the number of candidate workers; `maxSandboxes` caps live jobs
across every repository in this process; `jobConcurrency` caps jobs within one
candidate. Positive integer settings are configurable without an application
runner-count cap. Defaults are 4/4/4; the legacy pipeline adapter defaults to one
candidate worker. Separate pool processes have separate caps; all allocations
still use the configured Codegraff account and its available capacity/credit.
These are ephemeral sized fleet sandboxes, rather than personal cloud instances.
The [gateway documentation](https://codegraff.com/docs/sandboxes) describes their
resource and capacity behavior.

Use one token per repository, even when several repositories belong to the same
account. A pool config can override the image for each repository. The owner can
inspect registration names and active candidate counts, create more registrations,
and revoke them under Actions. Registration counts describe credentials, not the
number of worker processes sharing those credentials. Native `nh runner
list/create/recover/revoke` commands provide the same owner-only administration
through an explicit `runners:write` grant. Revoking the provisioning CLI grant
does not revoke the separate CI credential; revoke the runner registration too
when retiring it. The dispatcher validates every file's ownership, private mode,
host and repository before claiming work; file mode cannot also specify
`tokenEnv` and never falls back to an environment token. The API exposes safe
registration metadata at `GET /api/repos/:owner/:repo/ci/runners` to the owner.

This repository's workflow has separate unit, Git repository, CLI, access/vault,
hosting/pool, and build jobs. The stable `check/check` job depends on all six and
runs pinned tsrs. A failed prerequisite skips that final job. Require each prerequisite check,
or enable `successOnlyChecks` when requiring only the aggregate `check/check`: an
ordinary GitHub-compatible check accepts a reported skipped conclusion.

Logs are uploaded through a valid current runner lease into Nanohub R2, then read using current repository membership at `/api/repos/:owner/:repo/action-logs/:run/:attempt/:file.log`. They are served as private, non-cacheable plain text with `nosniff`. No separate log hosting service is needed. Completion is saved locally before uploads/callbacks for exact retry inspection. Actions shows candidate SHA/base, run state, individual jobs, sandbox IDs and private log links. Owners can rerun current checks; rerun clears prior staging approval. Runner revocation is available through the CI administration API.

Deployment remains a separate owner-approved exact-candidate path. A trusted staging adapter may follow successful Codegraff checks; ordinary workflow jobs receive no deployment secrets. The older Meld adapter remains available for its existing GitHub-backed transport, but the new `backend: "codegraff"` path bypasses it. An explicit `backend: "docker"` retains the earlier local execution option for compatibility.

## Verification receipt and activation limits

`bun run check` uses pinned **tsrs** across API, web and vault. `bun run --filter @swarm/api test:hosting` tests namespaces and the direct dispatcher; the existing Git, access, unit and team suites remain applicable.

The namespace fixture uses real Worker/DO/R2/D1 state, real private Git push/fetch, same-name repos under different owners, rename aliases, secrets continuity, cross-repo credential denial, native private logs, reruns, adoption and restart persistence. It also runs the actual dispatcher against a sandbox API fixture, including a real Nanohub clone, Git bundle, lease validation, log upload and result callback. Pool coverage races 32 HTTP claims across eight registrations, checks unique leases, reassigns revoked work and rejects stale delivery. Unit cases cover 260 queued candidates beyond the display window, multi-repository fairness, shared sandbox caps, shutdown drain, dependency concurrency/failure, and capacity retries. These are not live Codegraff VM execution receipts.

The original sandbox-fixture checks above did not establish live execution. The later [real Codegraff acceptance](evidence/codegraff-live-validation.md) proves a disposable production VM running a synthetic Bun job through the actual dispatcher and a local Nanohub Worker, including private log/result delivery and confirmed destruction. It uses the existing trusted CI configuration; the separately supplied Nanohub key still lacks the sandbox scope. The later [full-project Linux toolchain acceptance](evidence/codegraff-toolchain-validation.md) proves the image build and offline project gates. [Private registry acceptance](evidence/private-toolchain-registry-validation.md) subsequently retains the full image and passes all current offline project gates on a separate fresh VM with per-job temporary pull access and confirmed destruction of both VMs. An unattended production dispatcher and hosted Nanohub callback delivery remain unverified. Existing Meld runtime credentials and primary remotes remain unchanged.


## Explicit live acceptance

The live smoke is excluded from ordinary tests and requires explicit opt-in plus
an existing sandbox-scoped key in the trusted environment:

```sh
# Set CODEGRAFF_API_KEY privately in this process first.
NANOHUB_LIVE_CODEGRAFF=1 bun run --filter @swarm/api test:codegraff:live /absolute/private/artifacts
```

This allocates a billable, disposable fleet VM and tests an isolated local
Nanohub repository. The pinned official Bun 1.4.4 image has no project dependency
cache; this proves the executor's real cloud path, not all Nanohub CI jobs. It
uses the accepted-base workflow even when the candidate replaces its workflow,
checks the exact candidate, verifies no control credentials in candidate env,
reads the delivered log through the local API and rejects anonymous reads. It
confirms destruction via GET and retains a private receipt. No production
repository token or hosted Git mutation is needed. See the acceptance record
for the configured-key distinction and remaining activation requirements.
