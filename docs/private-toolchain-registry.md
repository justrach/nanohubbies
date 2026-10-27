# Private toolchain images

The trusted Codegraff dispatcher can use Cloudflare's managed container registry
with a fresh short-lived pull credential for each job. This provides retained
private images without depending on a large Codegraff workspace snapshot or
manually renewing archive URLs.

```json
{
  "backend": "codegraff",
  "image": "registry.cloudflare.com/REPLACE_WITH_ACCOUNT_ID/nanohub-ci@sha256:REPLACE_WITH_MANIFEST_DIGEST",
  "imageRegistry": {
    "provider": "cloudflare",
    "config": "/absolute/operator-owned/wrangler.jsonc"
  },
  "network": "none",
  "prepare": "bun install --frozen-lockfile --offline"
}
```

This is a configuration fragment. The Wrangler configuration and its existing
Cloudflare login/API credential belong to the trusted controller, outside
candidate source. Provision that access on the controller host before enabling
dispatch. Ordinary tests do not issue cloud credentials or allocate VMs.
The image must use the Cloudflare account namespace and an immutable registry
manifest digest. A Docker config ID from an archive is a different identifier.
Registry, archive-download and snapshot modes cannot be combined.

## Per-job preparation

After VM startup, the controller runs its installed Wrangler to request a new
15-minute **pull-only** credential. Jobs queued behind concurrency limits do not
share a credential issued when the dispatcher started. This uses Cloudflare's
[managed-registry credential command](https://developers.cloudflare.com/workers/wrangler/commands/containers/#registries-credentials).
The credential has account-registry scope; Cloudflare does not expose an
image-repository scope through this command. Use a dedicated Cloudflare account
if account-level image isolation is required.

Wrangler receives only the host environment needed for Cloudflare authentication.
Codegraff, Nanohub and GitHub credentials and Node preload options are excluded.
Wrangler's credential-bearing diagnostic output is redirected into a temporary
private directory and removed after issuance. Issuer output and errors are not
copied into job logs or callbacks.

The new VM receives only the temporary registry credential, inside an isolated
owner-only Docker configuration directory. Its one bounded `docker pull` runs
before any candidate source is uploaded. The preparation process removes that
directory before reporting success. The controller then verifies the exact
repository digest and current candidate lease. The job container runs with
`--pull=never`, without the Docker socket, registry config or control environment.
Neither the Cloudflare control credential nor the Codegraff API key enters the VM.
VM destruction remains mandatory on success, cancellation and failure.

Pull issuance, cleanup or image verification failure prevents candidate upload.
There is no mutable-tag or public-registry fallback. A slow pull is observed by
its unique completion marker; observation does not launch another pull.
Provenance retains the pinned image and provider, without credential values or
the operator's configuration path. The host login must remain usable for the
next job's issuance; this does not install an unattended controller by itself.

## Build and acceptance

Build `tools/codegraff/Dockerfile` on Linux/amd64 using its adjacent
`Dockerfile.dockerignore`. The context allowlist contains only the Dockerfile,
ignore file, lockfile and workspace manifests. The image contains public frozen
dependencies, Bun 1.4.4 and Node 24.14.1; npm/npx are removed. Publish using
separate short-lived push/pull access on a trusted build VM, remove that VM's
Docker authentication, and record the resulting registry manifest digest.
Do not reuse publication access for candidate execution.

The explicit `tools/verify-codegraff-toolchain.mjs` accepts this configuration.
It requires a sandbox-scoped Codegraff key, `NANOHUB_LIVE_CODEGRAFF=1`, a clean
credential-free source checkout and private artifacts outside that checkout.
For example, with the existing key available only in the controller environment:

```sh
NANOHUB_LIVE_CODEGRAFF=1 node tools/verify-codegraff-toolchain.mjs \
  /absolute/private/toolchain.json /absolute/clean/source /absolute/private/acceptance
```

It must run frozen offline installation, API/repository/CLI/access/hosting tests,
the production build and pinned tsrs in a **separate fresh VM**, then confirm
VM destruction. A successful image build or registry credential request alone
does not satisfy this gate. Hosted registration, callback and staging acceptance
remain separate release requirements.

The [live acceptance and sanitized receipt](evidence/private-toolchain-registry-validation.md)
record the retained full image, separate fresh-VM gates, private manifest access
checks and confirmed destruction of both build and test VMs.
