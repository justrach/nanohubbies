# Shared Actions capacity — local acceptance, 2026-10-29

This change adds a shared reservation ledger and trusted-controller lifecycle.
It preserves disposable per-job Codegraff VMs. It is not a single persistent
multi-customer VM, an account-specific paid tier system, or a production rollout.
The configured Nanohub Actions key's sandbox-scope blocker is unchanged. No
production token was issued, CI job claimed, VM allocated, Worker deployed or
Git ref modified for these tests. Real Git operations below use isolated local
Worker fixtures; Codegraff lifecycle responses are simulated.

## Results

- All **356 API unit tests** pass (`bun run --filter @swarm/api test:unit`).
- **53 focused tests** and the real Worker shared-capacity integration pass
  (`bun run --filter @swarm/api test:actions-capacity`). These overlap the unit
  count; they are not additional independent cases.
- The hosting gate passes its **51 unit cases** plus shared-capacity and
  namespace/Git Worker integration.
- Root `bun run check` passes operator binding validation and pinned tsrs checks
  for API, Vault, web and Worker. `git diff --check` passes. No frontend code,
  package dependency, lockfile or published CLI bytes changed.

## What the tests establish

The Worker fixture configures total capacity 3 and per-account capacity 2. It
creates five owned private repositories, seeds them through real authenticated
Git pushes, and claims real CI attempts. Twenty-four simultaneous HTTP
reservations alternating between two repository Sequencers under one owner admit
exactly two slots. Another owner can consume the third; another team cannot
exceed the total. Two repositories created by different people but connected to
the same provider issuer/room share one account limit. Renamed repository
addresses and old aliases observe the same ledger.

The tests verify exact reservation retries do not double count, another ID
cannot restart the same job/attempt, released tombstones cannot be reattached,
client-selected accounts/limits are rejected, stale attempts cannot reserve,
and a credential or receipt from another repository cannot inspect or release
the slot. Restarting the Worker retains allocations and counts. Revoking a
runner denies its cleanup requests without freeing its slot. A replacement
current repository runner can inspect and complete cleanup after archive cancels
the job; archive does not erase the ledger.

Controller tests establish receipt-before-request ordering, explicit capacity
denial polling, no write retry on a lost response, admission before provider VM
creation, VM ID receipt before attach, and release only after confirmed
destruction. Failed deletion retains an allocated slot. An unknown creation
result retains an allocation-pending receipt without a second creation. Lost
attach still destroys and releases the known exact VM; lost release leaves a
repairable receipt. Cancellation before creation and explicit provider capacity
rejection free a known unused slot. An incompatible capacity service stops the
updated controller before its CI claim. Existing Docker/pipeline behavior,
workflow dependencies and per-job isolation tests continue to pass.

Repair-tool tests deny release for a live VM, unknown VM ID, provider outage or
mismatched repository receipt. Exact provider 404/destruction can complete the
release. Current server authentication still applies to repair requests. The
actual Bun repair command also reads an environment-backed repository credential
and repairs an already-released receipt through the archived local Worker, using
config paths containing spaces/apostrophes and without leaking the credential.

## Limits

This is local functional/race acceptance, not measured production throughput,
provider attestation or a hosted dispatcher test. Trusted controllers assert
cleanup; this API does not constrain older controllers or direct provider users.
Deployment-first rollout, draining old controllers and reconciling existing VMs
are required before activation. Cross-deployment quotas, per-account entitlements,
compute profiles, fairness, spend budgets, retention and automatic orphan repair
remain open. See [the operator contract](../actions-capacity.md).
