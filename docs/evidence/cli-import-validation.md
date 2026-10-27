# Agent-free native CLI import acceptance

CLI **0.4.12** and main Worker `9f7e3a05-e3d3-40d4-8b89-e4b53aac3739` are
published. The [sanitized receipt](cli-import-receipt.json) pins implementation
`2b646d5`, runtime source hashes, the exact CLI module and cleanup. See
[command usage](../hosting-cli.md#import-complete-git-history).

## Behavior and authority

`nh repo import SOURCE -R owner/repository` uses an explicit content-read/write
CLI login, or ordinary repository Git credentials with `--git`. No agent is
registered. Git-only credentials retain their prohibition on application APIs.
The legacy registered-agent object API remains for older clients.

The Git transport extension independently checks credential/current membership,
mode, push rights, archive and empty state before bounded packed-object uploads.
CI clone leases cannot use discovery or upload. Final publication goes through
the existing graph, ref, policy and serialized empty-state fences. It neither
rebuilds commits nor changes source authors/IDs, remotes or local work.

Content-addressed batches can retry transport/429/503 errors with bounded
attempts and delays. Ref publication is sent once. A rerun with exactly the same
destination refs performs independent clone/fsck verification without writes;
different existing refs are refused. Clone authentication is transient,
URL-scoped, uses no external helper, refuses redirects/HTTP alternates and is
never written into its remote URL or configuration. The temporary clone is
removed. Source and global helper configuration stay unchanged.

## Local and actual Meld acceptance

Local gates pass **297 API unit cases**, **228 repository cases and the complete
real Worker/Git chain**, **47 CLI cases**, pinned tsrs in three workspaces,
full OpenNext build and Wrangler dry run. Source and standalone CLI fixtures use
Git and content-scoped API credentials to import over 100 refs without agents,
including binaries, executable mode, symlink and annotated/lightweight tags.
They exercise immutable-upload lost acknowledgements, final-response loss and
verification-only recovery, scope/role/cross-repository/archive/provider denial,
revocation and unchanged source/helpers. A real Git verifier rejects a cross-host
HTTP alternate before sending any request to it.

The exact **74,001-byte packaged module**, SHA-256
`7e86443cd1570ded5bcf9c6e95da5659a3a2506f11f6ade4d77238187881a0d3`,
runs against the actual complete private Meld snapshot in isolated local
Worker/DO/D1/R2. It imports **178 branches and 18,097 objects** (957 commits,
7,402 trees and 9,738 blobs; 621,196,033 expanded bytes). Strict independent
clone/fsck and all ref/tree/mode comparisons pass. No agent exists. A second CLI
run verifies the identical destination with zero new object/ref requests; token
revocation then denies another import. Source refs stay unchanged and the fixture
is destroyed. The whole import/resume/revocation run takes 276,692 ms locally.
This source has no tags; the synthetic fixture covers both tag forms.

## Separate fresh Linux VM

The first allocation receives provider HTTP 429 through its five-minute deadline
and creates no VM. A subsequent bounded attempt obtains a fresh Codegraff VM and
passes all eight gates against source
`1372752c9c6459486c587ed3bf4038fcc4787005`: frozen offline install, API unit,
full repository, CLI, access/vault, hosting/pool, build and tsrs. Candidate
execution is offline and lacks control keys, npm/npx and Docker socket. All ten
changed production runtime/configuration files match the executed snapshot.
Destruction is independently confirmed.

Additional CI-lease assertions are added afterward and pass both source and
bundled forms locally: an active lease can read HEAD, cannot discover/upload
imports, and loses read access after revocation. Their current test hash is
recorded separately; production runtime remains unchanged. The VM runs Nanohub's
gates, without receiving the private Meld source or proving hosted callbacks.

## Production rollout scope

Public manifest, CLI bytes/version/import help and fifteen real assets match
the build. Immutable 0.4.8–0.4.11 releases retain their bytes. All 27 bindings and
the 50,000-subrequest budget are unchanged. Worker-first routing remains enabled
and the recovery hold stays off.

Nine signed-in canary resources match exactly before/after: branches including
PR/review/CI state, protections, rulesets, default branch, archive, environments,
collaborators, secret metadata and runners. An anonymous private-Git probe returns
401, Basic challenge and private/no-store caching. Browser navigation encounters
that authentication challenge; no credential is entered. Its generated error
page prevents explicit tab cleanup, so the temporary tab remains unmarked for
automatic cleanup. No authenticated production import or new production grant
is claimed. Production refs, settings, secrets, reviews and runners stay intact.

The full actual Meld import is local. Hosted large-graph migration, Meld
application CI/staging, unattended Nanohub callbacks, complete hosted recovery
and traffic/security acceptance remain open. No vault deployment, GitHub push
or primary-remote cutover occurs.
