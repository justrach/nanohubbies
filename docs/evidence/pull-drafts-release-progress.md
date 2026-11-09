# Draft pull request release preparation — 2026-11-09

Implementation `44613fb04f78b20393a33f37eaedcc8c48ed41b1` is pushed to
`codex/standalone-git-host`; the remote head matched after publication. Staged
and full-history secret scans passed (129 commits). The [local acceptance](pull-drafts-validation.md)
records 565 API cases, 107 CLI cases and the repository, access/Vault, hosting
and pinned tsrs checks.

A separate clean Mac checkout passed frozen offline Bun installation, workspace
alias verification, OpenNext build and Worker dry-run bundling. All 1,286 source
files retain their frozen hashes, and 1,482 build files are recorded. The build
retains all 21 published CLI releases and includes candidate **0.4.22**. Exact
configured Codegraff control-key absence was checked across 2,768 source/build
files; this is separate from the general secret scans.

The frozen Linux run passed all nine gates: offline installation, API unit,
repository integration, CLI, access/Vault, hosting, hosted fixtures, production
build/artifact checks and pinned tsrs. The exact 0.4.22 artifact also passed its
draft lifecycle check inside this credential-free, network-disabled job. The
controller completed with exit zero, and a separate provider read confirms the
owned VM is destroyed. No successful hosted Actions dispatch is inferred from
this dedicated toolchain-validation run.

The first disposable Worker deployment succeeded, but a network timeout stopped
its delivery probe before complete acceptance. Its deletion is independently
confirmed, and the failure remains in the receipt. A second candidate passed
52 normal asset byte/MIME checks, 62 recovery-hold checks, a bodyless held HEAD
and 16 download-routing checks in each mode. Its deletion is independently
confirmed. Per-request receipts recorded 141 completed GET/HEAD reads with zero
network errors or retries. Bounded read retries are available in the private
probe; provider mutations are not automatically replayed. Both normal and held
upload commands completed with exit zero. Neither candidate binds production
resources or a custom domain. An extra endpoint probe ran after cleanup, returned
HTML and is excluded from acceptance.

Fresh read-only production checks after both probes confirm Worker
`64bda897-a8ba-4834-a98c-7b68c380a33f`, Vault
`0dbd5e74-5c41-428f-bc6a-2e8d3ecaef48`, CLI **0.4.21**, all 27 bindings,
Worker-first routing and the existing 50,000-subrequest limit. No production
Worker version was uploaded, no production traffic changed and no hosted draft
mutation was performed.

Browser diagnostics report that the Mac is locked, and browser transport is
unavailable even after a session reset. A manual unlock request is pending.
The native CLI has no saved API credential for the production test repository;
none was issued. Authenticated repository preservation baselines and hosted
draft interaction therefore remain pending. The prepared
preservation verifier allows only the explicitly added ready/default metadata
for existing PRs; synthetic self-checks reject changed draft status/revision,
Git refs and review records. It has not been run against a fresh authenticated
production baseline.

The [machine-readable progress receipt](pull-drafts-release-progress.json)
keeps pending release checks separate from completed local/Linux/Mac and
disposable delivery work. Authenticated production preservation, normal/held
production staging and rollout, public CLI retention and hosted lifecycle
acceptance are still required. This does not close Actions
activation, actual Meld staging/cutover or production operational readiness.
