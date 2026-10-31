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

Local results:

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

Fresh live acceptance of this correction is pending. The harness uses an
isolated local Nanohub and the existing real Meld checks-only pipeline; it does
not activate the hosted Nanohub fleet, deploy staging or production, replace
secrets/bindings, migrate a database, open a PR or change primary remotes.

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
