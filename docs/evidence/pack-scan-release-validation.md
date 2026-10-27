# Bounded Git graph scan release

Worker **`993b659a-8d24-442b-92b4-f5270a94029a`** replaces
`9f7e3a05-e3d3-40d4-8b89-e4b53aac3739`. The
[sanitized receipt](pack-scan-release-receipt.json) pins the runtime files,
fresh Linux source, cleanup and production checks. The earlier
[complete hosted Meld import](hosted-import-validation.md) proves the large-graph
path on isolated Cloudflare resources before this rollout.

The runtime correction is `f00b78d`; CLI build publication is corrected in
`858ff58`. A complete frozen source tree from `d139ab6` becomes the isolated
acceptance commit `708509158a85e7d7ce981924de34ca0f3d5b4f11`. All **908 source
files** match the working tree before rollout. The candidate contains no
controller key and runs offline without control credentials or a Docker socket.

A fresh Codegraff VM passes all eight gates: frozen offline install, API unit,
repository, CLI, access/vault, hosting/pool, build and pinned tsrs. The run uses
the retained private Cloudflare toolchain image and a per-job temporary pull
credential. The verifier confirms destruction, and an independent provider GET
confirms the `destroyed` tombstone. This validation uses the existing trusted CI
credential, without replacing the Nanohub Actions account key or registering a
hosted repository runner.

Production verification checks fifteen exact assets and their web MIME types,
the CLI manifest/module/help and immutable older CLI releases. CLI **0.4.12**
retains its exact 74,001 bytes and SHA-256
`7e86443cd1570ded5bcf9c6e95da5659a3a2506f11f6ade4d77238187881a0d3`.
All **27 bindings** and the **50,000-subrequest** budget remain unchanged.
Worker-first routing remains enabled; the recovery hold is off.

Nine authenticated private canary snapshots match exactly before and after:
branches including PR/review/CI state, protections, rulesets, default branch,
archive, environments, collaborators, secret metadata and runner registrations.
The browser keeps its authentication inside the browser. No new repository
credential is issued and no canary ref or setting is edited. The live Rules page
renders the expected controls with four stylesheets and the established theme.
Anonymous private Git import discovery still returns HTTP 401, a Basic challenge
and private/no-store caching.

The separately configured Nanohub Actions account key still returns provider
HTTP 403 for missing sandbox scope on a read-only check. Unattended hosted
Actions and callbacks, actual Meld application CI/staging, hosted recovery,
traffic/security acceptance and primary-host cutover remain open. Source has
not been pushed to GitHub at this checkpoint.
