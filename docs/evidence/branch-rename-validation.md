# Protected branch rename — candidate acceptance

Implementation `238ccb50c861561a1546a66b741196666663d396` and validation
correction `37b41c3105b822da0651d6c87632b33dedc50e87` are pushed to
`codex/standalone-git-host`. Main is unchanged. This record covers the
[branch rename contract](../branch-rename.md), not complete GitHub parity or
production readiness. This is frozen-source acceptance for CLI 0.4.20; deployment is a separate gate.

## Local acceptance

The implementation passes 435 API unit cases and 98 CLI cases locally.
After the validation correction, all 436 API unit cases and 100 CLI cases pass
under CI settings. The complete real Worker/Git
repository gate passes. Focused acceptance runs the source CLI and an actual
portable distribution against Miniflare, SQLite, D1, R2 and Git. It exercises
current roles and scopes, late revocation, default/protected branches, locks,
classic and ruleset policy continuity, original-pusher review independence,
PR closure and base retargeting, active CI read/completion lease invalidation,
storage-trigger ABA fencing, stale concurrent writes, atomic rollback, aliases,
archive/restart, old RPC receivers and lost acknowledgements without replay.
Independent clone/fsck checks retain binary bytes, modes, symlinks and tags.

Pinned tsrs/operator checks pass: two typed tasks are fresh and one cached.
The operator check covers ten files; it is not a full JavaScript typecheck.
The workspace build runs both tasks fresh. OpenNext subsequently builds 1,478
files, while all 1,134 frozen tracked source files retain their hashes. All 19
previous public CLI versions and their checksums are retained in the built
assets. The existing trusted CI control key is absent from those source and
built files; this exact-value check is not a general secret scan. An incremental
redacted Gitleaks scan of the implementation commit reports zero findings.

The local candidate is 100,963 bytes with SHA-256
`378a7d9ef090fc88146dc6198d3ce15330a27e711506c9da311f8e399065eeb3`.
Its installer retains SHA-256
`838ce409d0ece1c1bef6244ca707401abb7b15c711a44bdf644172963254576c`.
See the separate [design and browser evidence](branch-rename-design-validation.md).

## Failures retained

The first local smoke failed a harness field name: `gate` was corrected to the
existing `reviewGate` response. No product guard was weakened. A separate local
browser write returned 500 after Wrangler's ProxyWorker connection failed.
Inspection found the old branch present, the target absent and no rename audit;
the UI did not automatically replay it. Later independent renames succeeded.
The proxy failure's underlying cause remains unestablished.

The first frozen Linux run passes offline install, all 435 API unit cases and
the complete repository integration gate. Its CLI gate passes 96 cases and
fails both real Turbo cache integration cases. The retained failure output
identifies those tests but lacks their earlier diagnostics. The run is failed,
not a nine-gate pass. Its provider VM is independently confirmed destroyed.
Both failures reproduce locally with CI=true and GITHUB_ACTIONS=true. Turbo
reports real cache hits but groups its human-readable logs differently. The
corrected tests inspect actual JSON run summaries, assert misses after CLI
changes and local hits during restoration, and retain the corrupt-release check
and old-graph negative control. Both scenarios run under terminal and Actions
settings. The unchanged-source diagnostic VM was deliberately stopped once this
local reproduction established the cause; independent provider reads confirm
its destruction. It is not counted as a passing run. Failed gates now retain up
to 1,000 lines before the existing bounded runner-output tail; a shell regression
checks that an assertion survives a later test summary.

## Frozen Linux acceptance

Exact correction commit 37b41c3105b822da0651d6c87632b33dedc50e87 passes all nine
gates in a fresh VM: offline install, API unit, repository, CLI, access/Vault,
hosting/capacity, fixtures, build/exact-distribution integrations and pinned
tsrs/operator checks. All 436 API cases and 100 CLI cases pass; all three typed
workspace tasks are fresh with zero cache hits. The actual Linux module, checksum
and installer match the macOS distribution exactly.

Candidate execution has no network, control credentials, npm/npx or Docker
socket. It uses the retained digest-pinned trusted toolchain, not the intended
Nanohub Actions account. Destruction is independently confirmed by the provider.
The [sanitized receipt](branch-rename-receipt.json) preserves the failed, stopped
and successful attempts separately.

## Release boundary

Production baselines cover the current main/Vault versions, all 27 main
bindings, Worker-first assets, the 50,000-subrequest budget and nine authenticated
canary resources. These candidate checks do not claim a production deployment or issue any new
production credential. Account-specific compute tiers, hosted Actions
activation, actual application CI/staging, complete recovery, traffic acceptance
and the remaining compatibility work stay open.
