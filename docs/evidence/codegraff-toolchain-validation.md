# Full Linux toolchain acceptance — 2026-10-27

The [sanitized receipt](codegraff-toolchain-receipt.json) records the exact source,
image, gates and cleanup. The project's actual Dockerfile builds successfully on a real Codegraff sized
fleet VM. Its public frozen Bun cache supports every project gate with candidate
networking disabled. This extends the earlier [synthetic cloud job](codegraff-live-validation.md);
it does not establish an unattended hosted Nanohub dispatcher or staging cutover.

## Build and first full run

The build context contains only the Dockerfile, its allowlist, the root lockfile
and the four workspace manifests. It contains no candidate source, Git history,
local configuration or credentials. The image pins Bun 1.4.4 and Node 24.14.1 by
official base-image digests, removes npm/npx and prewarms public dependencies.

The first real build found that `/home/node/prewarm` was root-owned; the
Dockerfile now creates it with the non-root user's ownership before installation.
The CLI workspace manifest is included in the cache context as well.

Verified image ID:
`sha256:bfaf7d13f131017f3073514fdc51a09ac46ba3275e29862e3a223f3413a64907`.
Manifest-context SHA-256:
`f40d7ae72f2611920516a6fed45c6e42831b679935c4f595345b10368ee65004`.
This is a Docker config ID, not a published registry manifest digest.

An isolated source snapshot at
`0d28e90d46e7e69b1b3680ff8adab7312126eb0d` passed frozen offline installation,
256 API unit tests, 202 repository unit tests and every real Worker/Git repository
acceptance script, CLI tests, access/vault tests, hosting/pool tests, the production
Next.js build, and pinned tsrs across the three application workspaces. It used
the built image in a fresh container on the build VM. Bun and Node versions,
absence of npm/npx and absence of control credential variables were checked.

These snapshots are synthetic local Git copies of current nonignored project
source; no upstream commit, hosted branch, registration or policy was changed.
The repository harness now builds its CLI bundle inside the fixture instead of
depending on an ignored release asset left by a previous local web build.

## Transfer and observation fixes

The actual gateway rejected a 1 MiB binary upload with its 1 MB preview limit.
A 512 KiB upload succeeds. The dispatcher now sends 512 KiB binary chunks, leaving
room for base64 and JSON expansion. The 6.46 MB real project bundle transferred
successfully with these chunks. A byte-for-byte unit case covers multiple chunks
and bounds the serialized request size.

Long exec output is bounded by the provider. The dispatcher now bounds the log
tail remotely to 16 KiB so the end of a long test suite survives that limit.
This is a terminal excerpt, not a full unbounded build log.

## Private snapshot path

The provider's `includeDocker: true` snapshot reached `failed`, without a reason
in its public metadata. The same VM's small workspace-only snapshot reached
`ready`. A 2,320,192,512-byte Docker archive in a workspace snapshot also failed.
Compressing it to 826,656,413 bytes and snapshotting that smaller workspace failed
too. Each create had a distinct saved handle and was observed to terminal state;
none was retried merely because a client observation timed out. Size is an
experimental variable, not an established diagnosis.

The real `Codegraff.loadImage` helper successfully loads the gzip archive and
confirms the exact built image ID on the existing build VM. A fresh VM restore
of the full cache is **not verified**. All four owned snapshots are deleted,
including the ready small probe. The build VM is confirmed destroyed. No image
or snapshot is retained for unattended execution, and no default dispatcher
configuration enables this experimental path.

The experimental dispatcher path accepts an explicitly configured private snapshot plus an exact
Docker image ID. It restores the snapshot before transferring candidate objects,
checks the restored image ID and runs with `--pull=never`. An optional fixed
`imageArchive: "/workspace/nanohub-toolchain/image.tar"` loads a workspace-saved
Docker image before that check. The load is launched once and observed by its
exit file, so a slow operation is not restarted after an exec timeout. Failures,
lease cancellation, missing images or ID mismatches stop candidate transfer and
still destroy the allocated VM. Registry-digest configuration remains supported;
mutable tags and silent fallback are rejected.

`tools/verify-codegraff-toolchain.mjs` is an explicit opt-in full-project cloud
acceptance. It requires `NANOHUB_LIVE_CODEGRAFF=1`, an existing sandbox-scoped
control key, an absolute trusted toolchain config path, a clean credential-free
source checkout and an absolute private artifact directory outside that checkout.
It checks every gate, records the exact head/image/VM and confirms destruction.
It creates no hosted Nanohub credentials and is excluded from normal tests.
The new helper passes syntax validation; its fresh-VM full acceptance remains
unrun because no large snapshot became ready. Restore/load orchestration,
strict configuration, cancellation, mismatch refusal, candidate-transfer order,
cleanup and chunked uploads have local unit coverage. The latest local checks
pass 259 API unit tests, 28 hosting/pool tests plus real namespace Worker/Git
integration, pinned tsrs, and `git diff --check`.

## Scope

The existing trusted Codegraff CI configuration supplies control access only.
The separately supplied Nanohub key still lacks sandbox scope. There is no new
key, unattended service, registry publication or hosted Nanohub callback claim.
Production refs, reviews, policies, credentials, Worker and vault deployments
remain unchanged. Live staging/Meld migration acceptance remains outstanding.
