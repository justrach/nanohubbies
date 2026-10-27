# Real Codegraff Actions acceptance — 2026-10-27

A real production Codegraff fleet VM now passes through the actual Nanohub
Actions dispatcher, with an isolated **local Nanohub Worker/repository** and the
pinned official Bun 1.4.4 image. The
[sanitized receipt](codegraff-live-receipt.json) records the exact synthetic head,
accepted workflow base, image digest, allocated sandbox ID and checked results.
This is stronger than the earlier sandbox HTTP fixtures, but does not establish
an unattended hosted Nanohub CI service or full-project toolchain readiness.

## Configuration found and used

The existing private `~/.config/nanohub/actions.env` key still returns 403 with
the known missing `sandbox` scope diagnosis. A read-only sandbox-list probe of
`~/.config/codegraff/ci.env` succeeds. Both files remain mode 0600, and neither
value is printed, copied into the repository or replaced. The latter existing
CI key is supplied only to this test's trusted control process. This does not
silently change Nanohub's default account configuration or authorize new keys.
The private scope receipt is
`~/.config/nanohub/prod-validation-2026-10-27/sandbox-readiness.json`.

## Verified cloud path

1. The local fixture creates an ordinary private Git repository and local runner
   registration, then pushes a trusted workflow to main and a different candidate.
   The fixture's seed queue event is explicitly completed without checks before
   the candidate is pushed; it is not counted as a successful cloud run.
2. `runOnce` claims the actual candidate, clones with its read-only lease, creates
   a credential-free Git bundle and invokes the real Codegraff API. No gateway
   HTTP fixture or local Docker runtime participates in this live run.
3. A sized ephemeral fleet VM receives only committed synthetic objects and the
   job script. It runs a Docker container from the exact official Bun digest,
   with `network=none`, a non-root user and the existing capability/resource limits.
4. Bun 1.4.4 runs a real test that reads the candidate's changed file and checks
   the expected ref/SHA environment. The candidate changes its own workflow to
   fail, while the accepted-base workflow still supplies the executed job.
5. Candidate environment checks confirm the Codegraff key, runner token and
   other control credential variables are absent. The delivered log contains
   none of the actual gateway, local runner or Git token values.
6. The actual dispatcher uploads the private log and commits a successful result
   through the Nanohub API. An authenticated owner read retrieves the expected
   marker; an anonymous read is rejected with 404.
7. DELETE is followed by a GET observation confirming the sandbox is destroyed.
   The persisted cleanup receipt has `cleanupNeeded: false`. Local Git/runner
   fixture credentials are revoked and the local Worker is removed.

Final check: **live/bun — success**, checked at the timestamp in the receipt.
The private detailed artifacts are under
`~/.config/nanohub/prod-validation-2026-10-27/live-codegraff-verified/`.

## Corrections learned from real execution

The initial live fixture accidentally let its seed/main event be claimed before
its candidate. The cloud test correctly failed the candidate-content assertion;
its sandbox was destroyed. A second candidate run succeeded, while the harness
incorrectly expected deletion to remove the sandbox record entirely. The gateway
retains a **destroyed tombstone**, which is a valid terminal result. Both earlier
sandboxes were inspected and confirmed destroyed. The final run passes every
assertion, including private log access and direct cleanup confirmation.

The production dispatcher now confirms destruction after DELETE, accepting 404
or destroyed/deleted/expired states. Stopped, stopping, running and missing state
never clear the recovery receipt. Observation is bounded, refuses redirects and
uses short request timeouts. Unconfirmed cleanup retains the existing failure
and recovery-needed behavior. Unit tests cover terminal, absent, transient,
unknown and nonterminal responses; the namespace dispatcher fixture now models
real destroyed tombstones too.

Local regression checks pass: **252 API unit tests**, hosting/runner-pool tests
and actual Worker namespace integration, pinned tsrs across workspaces and
`git diff --check`. This change affects trusted dispatcher tooling and adds an
explicitly opt-in live smoke; no hosted Worker or vault redeployment is needed.
The live script is excluded from ordinary tests and normal CI to avoid implicit
cloud allocation.

## Remaining activation

- The Nanohub-specific key needs sandbox permission before it can run jobs.
  Existing CI configuration was used only for this acceptance test.
- The simple Bun job itself does not prove full-project readiness. A later
  [toolchain acceptance](codegraff-toolchain-validation.md) now builds the actual
  Dockerfile on Codegraff and passes all project gates offline. Registry
  publication and unattended hosted activation remain separate requirements.
- A registered unattended production dispatcher, hosted Nanohub log callbacks,
  full-project checks, staging deployment and Meld acceptance/cutover remain
  separate unverified requirements. Existing production refs, grants, policies,
  staging services and remotes are unchanged by this test.

The [Codegraff sandbox contract](https://codegraff.com/docs/sandboxes) describes
sized ephemeral VMs and the control API. That smoke created only its three disposable VMs and no new account key; no
personal or paused sandbox was touched. The later toolchain VM and its cleanup
are recorded separately in [toolchain acceptance](codegraff-toolchain-validation.md).
