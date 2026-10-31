# CLI release builds

`bun packages/cli/scripts/build.mjs` prepares the portable CLI distribution in
`apps/web/public/nh`. An optional positional directory selects a private output
for candidate checks. Both the CLI and installer are compiled before publishing
files. The command uses Bun; it needs no network access or provider credential.
Use the repository's pinned Bun 1.4.4 toolchain to reproduce published bytes.

The committed [release catalog](../packages/cli/release-lock.json) records the
byte length and SHA-256 of published modules. Its initial 19 entries are checked
against the actual public modules and checksums. A clean checkout must reproduce
the recorded bytes for an already published version. A different module requires
a new package version. A missing or malformed catalog stops the build; building
an older version than its highest recorded release cannot move publication back.
New versions must be greater than the highest recorded release.

Keep existing records unchanged. After a release is verified, append its exact
observed public length/hash to the catalog. This is a reviewed build guard, not a
signature or a storage permission boundary. An operator who changes the catalog,
uses older tooling or uploads assets directly can bypass it. It does not fetch
or reconstruct earlier release modules in a fresh output directory; release
operations must also retain and verify the older assets.

Within an output directory, a complete version contains `nh.mjs` and
`SHA256SUMS`. Both become visible through one directory rename. Existing module
and checksum bytes are never overwritten, including locally built candidates.
An identical rebuild succeeds. Partial/corrupt versions require explicit
reconciliation. Symlinks at release directories, version files or mutable heads
are rejected. This does not confine a hostile process with filesystem access.

Cooperating processes serialize publication with `.release-publication-lock` in
the output directory. They wait up to ten seconds using a monotonic clock.
`latest.json` cannot regress, and is replaced only after the version is complete.
The installer and current manifest are each replaced as complete files; they are
not a multi-file filesystem transaction. The installer remains an unversioned
entrypoint and can advance independently when module bytes remain identical.
These guarantees target local filesystems on macOS/Linux, not a distributed lock
service or protection against power-loss storage corruption. See the platform's
[rename API](https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromisesrenameoldpath-newpath).

The root Turbo graph makes the web build depend explicitly on the CLI build.
CLI publication always executes, including when the web task can reuse its
cached Next output. This recreates missing current downloads and checks existing
ones instead of restoring mutable heads from a task cache. Changes to the CLI
also invalidate the dependent web task. The web task separately retains its
Next output cache. Direct web builds still invoke the same publisher. These
settings follow Turbo's [task dependency and cache configuration](https://turborepo.dev/docs/reference/configuration).

## Interrupted builds and candidate work

An unresolved lock is retained. Do not remove it based on age: confirm the
relevant build processes/jobs have stopped before reconciling that output.
Compare the module, checksum, manifest and installer with the expected source
and recorded release. A failure during final renames may leave an updated
installer or a complete, unreferenced version. Inspect the actual files before
retrying; publication does not automatically roll back those individual writes.

For candidate iterations, use a fresh private output directory. Reusing a
candidate version with different bytes in an existing output also fails. To
reconcile an unpublished local output, preserve the previous files for inspection
and restore a consistent known manifest/installer before rebuilding. Published
catalog entries and earlier release artifacts must remain intact. A crash can
leave temporary files; remove only files confirmed to belong to the stopped
build. Build assets fully before uploading them.

Run `bun test packages/cli/test/build.test.mjs packages/cli/test/build-cache.test.mjs
packages/cli/test/publish.test.mjs packages/cli/test/install.test.mjs` for focused publication and installation
checks, or `bun run test:cli` for the complete CLI suite. The full frozen Linux
gate additionally exercises this builder in a fresh credential-free checkout.
