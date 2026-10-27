# Retained private image and fresh-VM full acceptance — 2026-10-27

The [sanitized receipt](private-toolchain-registry-receipt.json) records the
immutable image, source, gates and confirmed cleanup. This closes the previous
full-image retention and fresh-VM distribution gap. It does not establish an
unattended hosted Nanohub dispatcher, callback delivery or staging cutover.

## Publication and retained access

The existing Cloudflare account's managed container registry is available
through its existing Wrangler login. A dedicated `nanohub-ci` image repository
now retains the actual Linux/amd64 project toolchain. A trusted Codegraff build
VM receives only eight allowlisted Dockerfile/ignore/lock/manifest files.
Candidate source, Git history, configuration and control credentials are not
build inputs. Bun 1.4.4 and Node 24.14.1 are verified, with npm/npx absent.

After the build, a separate 15-minute publication credential is issued on the
host and transferred only to an isolated owner-only Docker config on the build
VM. The image is published and that config removed. The build VM is confirmed
destroyed before full-project acceptance starts.

Registry manifest digest:
`sha256:76f35e83a77df1d8eace6e8fc49b7f77d6dcd6d90bbaf40722c5c5f9f8bd6694`.
Docker config ID:
`sha256:9c299c174364eb5562d19716ac08d1e8a18f624aa4223e7440935f0f578ca379`.

A subsequent authenticated HEAD returns HTTP 200 with that exact manifest
digest. An anonymous HEAD to the same manifest returns HTTP 401. The registry
catalog lists the retained `nanohub-ci` tag. No unrelated image or application
resource is changed.

## Separate fresh VM

The real `tools/verify-codegraff-toolchain.mjs` runs the actual dispatcher helper
against a clean private source snapshot at
`6bcb3997f542fd61fa25eba78315c1a11da9bea8`. This is a synthetic local Git
snapshot of current nonignored source, without deployment configuration or
credential files; it is not a pushed branch or hosted Nanohub repository.

A second new Codegraff VM requests a fresh **pull-only** credential after
startup, pulls the retained image, removes its owner-only registry auth
directory and verifies the exact repository digest before source transfer.
The helper uses unique completion markers and observes one pull operation.
The candidate then runs with `--pull=never`, `--network=none`, restricted
capabilities and only source/script mounts. It verifies Bun/Node versions,
absence of npm/npx, absence of gateway/Nanohub/GitHub/Cloudflare control
environment variables and absence of a Docker socket.

Every full-project gate passes: frozen offline install, API unit tests, the
complete real Worker/Git repository chain, CLI, access/vault, hosting/pool,
production Next build and pinned tsrs across three workspaces. The final
`NANOHUB_FULL_LINUX_PASS` marker and every named gate marker are retained.
The verifier confirms VM destruction before returning success. Private logs
contain no gateway key; registry credentials never enter candidate logs or
returned provenance.

## Controller and regression coverage

Local acceptance passes 282 API unit cases, the complete repository chain,
36 hosting/pool cases plus namespace Worker/Git integration and pinned tsrs.
The repository chain's first local run has 213 unit cases; the subsequently
added pre-claim registry-validation case passes in the focused gate and is
included in the later full Linux repository run. The Linux receipt records
gate success, rather than inventing counts omitted by the bounded log tail.

Tests cover strict registry namespace/digest/configuration, mixed-mode refusal,
rejection before a hosted claim, new credentials for both jobs of a real-Git
workflow, pull-only TTL arguments, exclusion of other control credentials and
Node preload options, removal of Wrangler's temporary credential-bearing logs,
one pull launch, unique markers, auth-directory permissions/cleanup, source
transfer ordering, immutable candidate execution, cancellation/expiry, provider
errors, wrong digests and confirmed VM cleanup. Provider exception text is
replaced before entering a job log. Malformed credentials fail generically.

## Remaining release gates

Cloudflare's credential command grants account-registry pull access, not
per-image repository access. It stays in trusted preparation and is removed
before candidate upload. See [configuration and authority](../private-toolchain-registry.md)
and the [official credential command](https://developers.cloudflare.com/workers/wrangler/commands/containers/#registries-credentials).

This isolated acceptance uses the existing trusted CI key. It does not replace
the separately configured Nanohub key, whose last check still lacks sandbox
scope. No runner registration, hosted callback, unattended service, staging
deployment or Meld cutover is activated. Primary remotes, production refs,
policies, reviews, vault values, main Worker and vault deployments are unchanged
by this controller-only work. Hosted recovery, load/security/operations and the
original application migration/staging requirements remain release gates.
