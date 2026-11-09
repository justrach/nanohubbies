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

The frozen Linux run is still in progress. Its fresh provider observation
confirms the same VM is started, without a completed test gate at this
observation. It has not been restarted, and neither Linux success nor cleanup
is claimed. The private operation record retains the controller/session/VM
handles for continuation.

Fresh read-only production checks confirm Worker
`64bda897-a8ba-4834-a98c-7b68c380a33f`, Vault
`0dbd5e74-5c41-428f-bc6a-2e8d3ecaef48`, CLI **0.4.21**, all 27 bindings,
Worker-first routing and the existing 50,000-subrequest limit. No candidate
Worker upload, production traffic change or draft mutation was performed.

The browser transport is unavailable. Authenticated repository preservation
baselines and hosted draft interaction therefore remain pending. The prepared
preservation verifier allows only the explicitly added ready/default metadata
for existing PRs; synthetic self-checks reject changed draft status/revision,
Git refs and review records. It has not been run against a fresh authenticated
production baseline.

The [machine-readable progress receipt](pull-drafts-release-progress.json)
keeps pending release checks separate from completed local/Mac work. Disposable
normal/held delivery, independent cleanup, production preservation/rollout and
hosted lifecycle acceptance are still required. This does not close Actions
activation, actual Meld staging/cutover or production operational readiness.
