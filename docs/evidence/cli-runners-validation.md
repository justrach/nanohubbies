# Runner registration CLI acceptance

CLI **0.4.11** is published with native `runner list/create/recover/revoke`.
The [sanitized receipt](cli-runners-receipt.json) records the implementation,
executed source hashes, public module and exact hosted version. See the
[command and credential contract](../hosting-cli.md#runner-registrations).

## Authority and credential handling

The explicit `runners:write` scope requires the current repository owner at
issuance, gateway dispatch and final serialized mutation. It is absent from
default login scopes. Admins, ordinary grants and Git/agent/CI credentials gain
no registration authority. Provider failure or demotion denies the operation.
Older receivers return retryable 503 without an unconditional browser fallback.

The CLI generates a 256-bit credential and registration ID, then exclusively
writes and fsyncs an owner-only file before sending the registration. It refuses
existing files and locations inside Git checkouts. The server stores only the
credential hash. A lost acknowledgement is recoverable using the same ID, name
and key; conflicting or revoked registrations cannot be revived. Output and
activity expose safe metadata only. Recovery and pool loading reject symlinks,
unsafe permissions, oversized files and mismatched host/repository contexts.

CI credentials have their own lifetime: revoking or expiring the provisioning
CLI grant does not revoke them. The deployed consent text explains this.
Explicit runner revocation invalidates read leases and callbacks and requeues
in-flight candidates. Repeated revocation still performs cleanup without a
duplicate audit. Existing grants can list/revoke while archived; new grants,
registration and recovery remain blocked. Trusted pools accept separate absolute
private files for each repository, validate all targets before claiming, and
never silently fall back to environment credentials.

## Local and fresh Linux acceptance

Local gates pass **292 API unit cases**, **223 repository unit cases and the
complete real Worker/Git chain**, **47 CLI cases**, **37 hosting/pool cases and
real namespace/Git integration**, pinned tsrs in three workspaces, full OpenNext
build and Wrangler dry run. Both source and bundled CLI fixtures exercise a
successfully committed but lost registration acknowledgement, recovery without
duplication, unchanged Git refs, independent credential lifetimes, immediate
lease/callback denial, requeue to a second registration, safe audit, archive,
device-consent demotion, provider failure and restart persistence.

An earlier fixture expected unknown-route 404 for ordinary grants; the new
recognized runner endpoint correctly returns missing-scope 403. Those assertions
were corrected. A later Mac run encountered SQLite disk I/O while disk space was
exhausted; the complete repository gate subsequently passed. Only this project's
completed generated Next cache was removed; unrelated worktrees were retained.

Fresh private Linux source `6d646750d6abb6827fa273d2554373cddd5b96e8` passes all
eight actual verifier gates: frozen offline install, unit, full repository, CLI,
access/vault, hosting/pool, production build and tsrs. It uses the retained
digest-pinned private Cloudflare image with temporary per-job pull access removed
before source upload. The candidate has no control credentials or Docker socket,
has no npm/npx and runs with networking disabled. All **30 changed runtime,
configuration and test files** match the executed source by SHA-256; subsequent
changes are documentation only. The first assertion-failing VM and final passing
VM are both independently confirmed destroyed. This exercises the real Codegraff
provider, without a hosted Nanohub registration or completion callback.

## Production rollout and limits

Main Worker `3730337d-2922-4317-8fa2-62ee31b4f62f` serves CLI 0.4.11. The public
manifest/module match the build; the identical module executes outside the
checkout and advertises runner and environment commands. Fifteen selected real
assets match exact bytes and appropriate MIME types. Immutable CLI 0.4.8, 0.4.9
and 0.4.10 retain their bytes. All **27 binding metadata entries** are unchanged;
Worker-first asset routing stays enabled and the recovery hold remains off.

Signed-in reads match exactly before/after for nine canary resources: branches
(including PR/review/Actions state), protections, rulesets, default branch,
archive, environments, collaborators, secret metadata and runners. Permission
discovery offers `runners:write`; the owner control is enabled and **unchecked**,
the lifetime warning renders, and no active CLI credentials exist. The
[production screenshot](cli-runners-production.png) records this state.

Production verification covers publication, permission discovery and read-only
preservation. No production credential, runner, Git ref, review or policy is
created or modified. Mutation acceptance uses the actual isolated Worker/D1/DO
fixture and fresh Linux run. The temporary verification tab is closed. No vault
deployment, GitHub push or application cutover occurs. A read-only check of the
configured Nanohub key still returns sandbox-scope 403 without allocating a VM;
the separate existing sandbox-scoped CI key was used only for isolated cloud
acceptance. Unattended hosted callbacks, real application staging, hosted
recovery, load and security operations remain release gates.
