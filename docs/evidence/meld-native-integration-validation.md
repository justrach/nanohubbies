# Meld integration CI — 2026-11-09

The private integration proposal `b66b12d23b6c20154d2b952e7ddfc3ca308a460d`
preserves both tested main history and the inspected staging history. A fresh
local Nanohub fixture imported its supplied main ref and all 19,848 reachable
objects, then created accepted workflow base `7680a39a` and test candidate
`82b0536e248ea2cddaa5ac1d75406c97635d07a9`. These synthetic fixture commits
are distinct from the proposed application integration commit.

The [canonical receipt](meld-native-integration-attempt-8.json) records real
Codegraff run `348f667d-4d3f-49b5-80fc-1e06148ad40e`: 40 policy/guard tests,
4,304 unit/package cases and 477 browser cases pass. The 205 unit/package and
73 browser skips do not establish verified behavior. Frozen offline dependency
installation, pinned-tsrs checks, production build and Wrangler dry-run pass.
The network-disabled candidate container receives no controller credentials;
the provider independently confirms its VM was destroyed.

The canonical consumer verifies the exact run, attempt, source, toolchain and
package hashes, including the committed Worker wrapper. The package contains
four modules, 315 asset files and its descriptor: 320 files, 42,020,970 bytes.
Read-only uploader preparation accepts its ancestry from inspected staging
`194a45ea41ba031f2ab6eaa117d666cf33ec53ed` and prepares 314 deployable assets
after asset-control exclusions. That uses the retained inspection baseline;
it does not establish a fresh deployment authorization or reserve shared staging.

Direct protected writes fail, PR creation refuses absent staging before and
after CI, and a deliberate retry invalidates the earlier successful result.
Import, Git and runner credentials are revoked and denied; the fixture is closed.
The retained success is historical evidence, not authority to deploy after retry.

This is integration CI, separate from the earlier [isolated PR-head run](meld-native-package-validation.md).
No original Meld ref, shared schema or deployment changed. Owner review, staging
schema compatibility, a configured live-test credential, coordinated deployment
and real-service acceptance remain required before any Meld PR or cutover.
