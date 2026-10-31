# Branch rename help — 0.4.21 source candidate

Commit `c194a189998d5cf3c866b82df0875f13f22ca9a7` adds the missing
`branches:write` explanation to general CLI help. It describes current writer
versus protected/default admin requirements and retained locks. This fixes the
help omission observed during [0.4.20 release checks](branch-rename-release-validation.md).
The grant and branch commands already work in published 0.4.20.

The package and Bun workspace version advance to **0.4.21** so the published
0.4.20 bytes remain immutable. The new module is 101,134 bytes with SHA-256
`4e94fe36efe7af2b2866eb37ec8c3d5d0bf786462ed3150903de4be8a0d064b3`.
It is built only into private candidate output, not public assets or the release
catalog. See the [receipt](cli-branch-help-receipt.json).

All 101 CLI cases pass with CI/Actions settings, including a new actual portable
`--help` execution outside the checkout with no credentials. The focused branch
rename gate passes its 11 unit cases and source plus real portable CLI/Worker/Git
integration, including protection, pusher independence, PR effects, SQL races,
revocation, aliases and clone/fsck. Offline frozen install passes without a
dependency change. Pinned tsrs/operator checks pass; all three unchanged typed
workspace tasks are cached. This is not a new full Linux acceptance run.

No server implementation or production deployment changes here. Fresh public
reads still report **0.4.20**, with its recorded length/hash unchanged. The
0.4.21 candidate still needs its own release acceptance before publication.
