# Meld staging ancestry — 2026-11-09

The existing Meld pipeline credential successfully reads staging deployments,
settings, versions and exact deployed-version resources. The previous 403 used
this Mac's separate Cloudflare login. The [receipt](meld-staging-ancestry-receipt.json)
records four successful reads, all 34 binding roles and a private target profile;
no secret values were read and no provider mutation occurred.

The existing passed deployment run
`1794120777291-f8a55127-3412-4265-94dc-a9abce2d5680` names full source
`194a45ea41ba031f2ab6eaa117d666cf33ec53ed`, and its deployment log names
the currently deployed Worker version `f031321f-7869-45d0-9345-245972b9f9c2`.
The live `/api/version` reports `194a45e`. This supplies the full source mapping
needed by the operator profile; a short build prefix alone is insufficient.

A separate read-only fetch establishes that main `e2388418` and staging
`194a45ea` diverge from `6b580e67`: 12 commits exist only on main and 155
only on staging. The current main-based native CI candidate therefore cannot
replace staging directly. A private merge-tree preview reports one conflict,
`packages/db/migrations/meta/_journal.json`: each side adds a different `0048`
migration. No conflict was silently resolved, no original ref was moved and no
shared database was migrated. A reviewed integration candidate remains required.

The native uploader now requires `baseline.sourceCommit` and verifies its real
Git ancestry before preparing a package. Git replacement objects are disabled;
graft files, unknown commits, tag-object IDs and divergent candidates are refused.
The immutable plan binds that staging base, so changing it after preparation
cannot reuse the proof. Real-Git tests exercise divergence, a forged replacement,
grafts and a successful merge containing both histories. Refusal occurs before
credentials or provider writes. All 527 API tests and 18 focused checks pass;
operator binding/syntax preflight covers 20 files and is not a full typecheck.

The legacy controller had no running or queued jobs at observation time. This
does not establish an exclusive deployment window or cross-controller lock.
The real Pinterest/X/Telegram acceptance credential and trusted acceptance module,
integration-candidate checks, coordinated staging deployment and protected
merge/cutover acceptance remain open. The separate full PR-head CI run continues;
its success cannot substitute for integration or real-service acceptance.
