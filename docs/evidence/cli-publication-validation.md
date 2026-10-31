# CLI release publication — 2026-10-31 (SGT)

The publisher refuses changed bytes at an existing CLI version and checks a
committed catalog even when a clean checkout has no prior output. A root web
build also runs the publisher before reusing cached Next output. The code is
published on the feature branch; this is build-tooling acceptance, not a new
application deployment or hosted Actions activation.

The immutable publisher is frozen at
`1fc68c5e9ba70837baecc47b2cd4f717e9ebddf4`. The cache-graph follow-up is
`41ffee68f0b2af28f5c4ff11b4fa800b0db3f5b0`. It changes only the root Turbo
configuration, a real Turbo integration test and the build contract. See the
[sanitized receipt](cli-publication-receipt.json) and
[publication contract](../cli-release-builds.md).

## What is protected

The release catalog's 19 entries, 0.4.1–0.4.19, were compared with all 19 actual
public modules and all 19 checksums before the guard was committed. Existing
version files are compared rather than rewritten. A new module requires a
higher package version. Complete version directories are published by rename;
cooperating processes serialize mutable head updates, refuse a latest-version
rollback and retain an unresolved lock rather than guessing that its writer died.

A reproduced cache regression showed a web-only Turbo build returning old output
after a CLI-only change, without invoking the publisher. The fixed graph has an
explicit CLI dependency and disables publication-task caching. Its tests execute
real Bun builds and Turbo cache operations in private synthetic repositories:
changed CLI source invalidates the web build; a warm web cache restores its Next
output while missing current downloads are rebuilt; corrupt version bytes stop
publication without overwriting the corrupt evidence. The former graph is kept
as a negative control. It demonstrates the bug rather than merely asserting the
new JSON settings.

## Acceptance

- macOS: 95 CLI cases pass across 19 files, including 14 publisher cases and two
  cache integration cases. The workspace build passes with both tasks fresh;
  a subsequent warm build executes CLI publication and reuses the web cache.
- The pinned project tsrs/operator check passes. Its three unchanged typed
  workspaces are cached locally; the operator check examines ten files and is
  not a complete JavaScript typecheck.
- All nine frozen Linux gates pass at the publisher commit: offline install, API
  unit, repository, CLI, access/vault, hosting, fixtures, production build and
  pinned tsrs. That checkout passes 424 API unit cases, 93 CLI cases and fresh
  uncached typed workspace checks. The provider independently confirms the VM
  destroyed.
- A separate restricted container on that same VM applies only the exact two
  follow-up source files to a private copy of the frozen checkout. It verifies
  both overlay hashes, installs offline and passes all 95 CLI cases, including
  the cache regression. The base checkout remains read-only. The container is
  removed; this is a targeted final-config addendum, not a claim that all nine
  gates ran again at the later commit. No extra VM was allocated.
- Public HTTPS reads confirm CLI 0.4.19 remains 97,845 bytes with SHA-256
  `e86b40b33b6b2a4483073083054bd7d4605e835672c0e8bc32c90ddba2f0195e`.
  Its checksum and unversioned installer also match local bytes exactly.
- An incremental redacted Gitleaks scan of the two implementation commits
  reports zero findings. Source publication is verified by an exact remote-head
  read; main remains unchanged. No production repository credential is created
  and no application deployment is performed.

The first local publisher run failed a test's assumed diagnostic wording: Bun
reported its native syntax error. The assertion was corrected to require that
installer error and unchanged distribution. The first cache-graph attempt failed
because the package-specific task did not inherit the generic Next outputs;
explicit outputs were added and the real cache restoration then passed. Both
original failure logs are retained privately; neither is counted as a pass.

## Limits

The catalog is a reviewed source guard, not a signature, provider IAM restriction
or protection from an operator changing the catalog or uploading files directly.
Installer/latest updates are individually atomic, not a multi-file transaction.
A crash can retain a lock or a complete unreferenced version; recovery requires
inspection after confirming the writer stopped. Earlier modules must still be
retained by release operations; a fresh build does not reconstruct them.

No server, vault, installer or versioned CLI runtime change is deployed here.
Hosted dispatcher activation, actual application CI/staging, complete recovery,
traffic acceptance and the remaining GitHub compatibility work stay open.
