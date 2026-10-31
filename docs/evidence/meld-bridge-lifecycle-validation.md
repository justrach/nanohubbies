# Meld bridge lifecycle — 2026-10-31

The trusted checks adapter now retires its temporary GitHub mirror before
returning native success. It uses the still-present Nanohub checkout, an exact
expected-old-SHA deletion lease and a private durable intent. Shared staging is
never eligible for this operation. A changed or recreated ref is preserved.
Lost acknowledgements reconcile through absence; an uncertain intent with a
remaining ref never authorizes a second automatic deletion.

This closes the checkout-lifetime problem in the earlier
[live bridge harness](meld-bridge-freshness-validation.md). It does not convert
that earlier failed harness into a pass. Cleanup checks the controller's terminal
job and pending users of the ref, then the adapter observes the exact CI job again
before returning native success. Git and controller observations are not a
distributed transaction. External reruns after the final observation still need
callback integration.

Staging dispatch now preflights its real-service acceptance module before a
shared staging push or controller POST. The file must resolve outside candidate
execution, load successfully and export `accept`; a symlink into candidate code
is rejected. The selected module cannot switch during an attempt. This is a
trusted-operator module contract, not confinement of arbitrary module imports.

Local results at the live run's frozen source:

- 468 API unit cases pass.
- 39 focused adapter/cleanup cases pass on both Node and Bun. Real local Git
  covers expected-old leases, changed-ref races, lost acknowledgements, failed
  final reads, concurrent cleanup and recreated refs. Fixtures cover pending
  controller jobs, shared-staging refusal, acceptance preflight and a newer rerun
  during cleanup.
- `bun run check` passes three pinned-tsrs tasks, two fresh and one cached, plus
  operator entrypoint checks. It does not establish full operator typing.
- The new opt-in live harness is syntax-checked and refuses to dispatch without
  `NANOHUB_LIVE_MELD=1`.

Read-only discovery confirms existing Meld controller authentication, an idle
queue and staging build `77d528a` matching its branch. Current GitHub main is
`a5a6e2b3da5d7917a4d197bbb72dc3807d5d7fed`. A private bare copy passes strict
fsck; original worktrees are untouched. The configured trusted acceptance module
is absent, so no staging dispatch is attempted. The GitHub connector cannot read
this private repository; existing GitHub CLI/Git authentication supplies the
pinned source reads. Secret values remain outside reports and candidate code.

Fresh [live lifecycle acceptance](meld-bridge-lifecycle-live-receipt.json)
passes from committed trusted-tools source
`f839cc8ca4ea9a3eb072d21ede5618f46c1843ed`. The exact published CLI 0.4.21 imports
16,055 reachable objects and the current main ref into an isolated local
Nanohub fixture; independent clone/strict fsck passes and the import credential
is revoked before CI. This candidate-only copy does not replace the earlier
full-graph migration acceptance.

Real Meld job `1793435792633-9ec0c387-5ba4-4de0-8b0e-ff5a40b5d7ff` passes all
seven required stages. Its three unit/package groups report 407, 1,793 and
1,344 passing tests; the middle group skips 201 tests across nine skipped files.
Browser checks report 444 passed and 68 skipped. The production bundle passes.
These skips do not establish their omitted database/service behaviors.

The native callback reports exact-head/base success. A newer native retry clears
that pass. The temporary mirror is removed before success and independently
confirmed absent; the provider VM is independently confirmed destroyed. Runner
revocation returns 403, the local fixture closes, and GitHub main/staging refs
and staging build `77d528a` remain unchanged. No cleanup errors remain.

The harness uses the existing Meld account. It does not activate the hosted
Nanohub fleet, establish hosted callbacks, deploy staging or production, replace
secrets/bindings, migrate a database, open a PR or change primary remotes. The
intended hosted Nanohub account key still returns missing sandbox scope.

## Execution trust boundary

Pinned Meld source shows its bootstrap invokes `tools/staging/run.mjs` from
the candidate checkout. That script runs candidate commands and writes
`/workspace/result.json` in the same guest environment. The bridge does not
isolate candidate commands from that result writer. Comparing entrypoint blobs
alone would not address this boundary. No exploit was executed.

This live run's candidate equals its accepted workflow base and current main:
`a5a6e2b3da5d7917a4d197bbb72dc3807d5d7fed`. Its pass establishes the recorded
accepted-main lifecycle; it does not establish safe unaccepted-branch execution.
The subsequent adapter restriction rejects `head != base` before Git, provider
requests, acceptance imports or receipt replay, including owner-approved work.
Use Nanohub's native isolated Codegraff backend for feature-branch CI. General
Meld staging from feature candidates still requires a trusted workflow plan,
isolated execution/result reporting and real-service acceptance; this gate
does not declare that work complete.

The subsequent restriction passes 470 API unit cases, 41 focused adapter/cleanup
cases on both Node and Bun, and all 55 hosting unit cases plus real Worker
capacity/namespace/Git integration. Rejection tests cover both approved and
unapproved feature candidates, existing passing external work and acknowledged
older feature receipts; no Git command, controller request, acceptance import
or new receipt is reached. Native backend tests continue to execute a different
candidate from its accepted-base workflow, including candidate workflow
replacement. This is fixture coverage, not a new live untrusted-code isolation
audit. Pinned tsrs checks pass all three tasks (two fresh, one cached), plus
operator binding checks. No production deployment is included in this change.

Run from a clean committed trusted-tools checkout, with a private bare source:

```sh
NANOHUB_LIVE_MELD=1 bun packages/api/scripts/smoke-meld-live.ts \
  /absolute/private/source.git /absolute/private/staging-pipeline.env \
  /absolute/private/codegraff-staging.env /absolute/private/new-artifacts
```

The artifact directory must be new and outside both repositories. Keep it
private. An uncertain job/ref operation requires observation of its retained
receipt, not replaying the launch. The result is successful only after native
callback, retry invalidation, credential revocation, mirror/provider cleanup and
unchanged shared-state checks have all been durably recorded.
