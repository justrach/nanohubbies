# Operator recovery request hold — 2026-10-27

The request fence is implemented and passes targeted local and isolated hosted
acceptance. **It is not yet deployed to the main site.** Main-site version
`7b1af261-899b-4870-94f1-c25cf25fc6e7` remains available. The
[receipt](recovery-hold-receipt.json) separates those states. Do not rely on the
operator variable until an aware main-site build and actual 503 responses are
verified.

## Local result

Three unit cases test the exact API and web entrypoints plus the shared control.
Only omitted configuration or the exact string `"0"` opens requests. Configured
empty, malformed and unexpected values hold traffic. Headers, queries, cookies
and authorization do not exempt a request. The API test uses binding getters
that throw: held requests must return before auth, throttle or storage access.
The web test proves Next/API/legacy delegates are not called while held and
ordinary routing still works after an explicit local release. Responses are
private/no-store HTTP 503 with retry metadata; HEAD is bodyless.

The actual web entrypoint also runs through Miniflare's asset router with
synthetic Next/API delegates and real static fixture files. Canonical normal
and artifacts configurations both require Worker-first asset routing. Static
HTML, a Next asset, CLI manifest and API requests work normally and all return
503 for held, empty and malformed control values. Explicit release restores
normal delivery. This tests platform asset routing, beyond direct handler calls.

The cold DO/D1/R2 drill keeps operator configuration outside its snapshots.
Restoring an older checkpoint does not clear the request hold. Restored member,
Git, CLI, MCP, runner and workload credentials, the owner, sign-in and public
help requests all receive 503. Restart keeps the hold. Only the isolated
loopback fixture is released to demonstrate restored stale authority and apply
the known removals/revocations through owner APIs; denial survives another
restart. The hold does not itself revoke those restored records.

## Live Cloudflare result and cleanup

A fresh disposable Worker uses the real built application entrypoint and static
assets with `NANOHUB_RECOVERY_HOLD: "1"` and `run_worker_first: true`. Its only
bindings are static assets and that control variable. It has no repository,
Durable Object, D1, R2, legacy service or vault binding, and no production
credential. A broken fence cannot read private application state there.

Version `c68d5754-24a3-4002-98d6-39874ec4e16f` returns the expected private 503
for all 17 HTTP checks: root/dashboard/repository/CLI consent, actual CLI static
manifest and release file, help and OAuth callback, live/MCP/CLI API routes,
CI claim, secret redemption, Git clone advertisement and receive-pack, HEAD
and OPTIONS. Responses retain the recovery code/headers and no Set-Cookie.
The real CLI release asset is not served ahead of the fence.

The main site returns HTTP 200 in the checks and still reports
its existing version afterward. The disposable Worker is deleted successfully;
a separate Cloudflare deployment lookup confirms `10007: Worker does not exist`.
No probe runtime or storage binding remains. No main-site hold or restore was
performed, and the vault service was not changed.

## Regression gate and rollout limit

All 270 API unit tests and all 213 curated repository unit tests pass. Targeted
cold recovery and real asset-routing acceptance pass. Pinned tsrs passes all
three workspaces; Next.js/OpenNext production build and Wrangler deployment
dry-run pass. The main-site configuration has Worker-first routing ready and
does not introduce a hold variable or clear any operator-controlled value.

Three aggregate repository attempts encounter local Git connection failures at
different Worker/Git scripts: ruleset roles, force-push actors and Unicode refs.
The error is an inability to connect to the loopback server, rather than an
expected policy rejection. Roles and force-push acceptance pass in separate
rechecks. One diagnostic run observes `EADDRNOTAVAIL`, and the Mac has up to
32,424 TCP TIME_WAIT entries; this suggests local transport pressure but does
not establish a complete diagnosis. The full aggregate gate is **incomplete**,
not green. No main-site rollout was issued on this evidence.

This is a new-request fence, not a drain of in-flight work, existing WebSockets,
DO alarms, imports or direct RPC. It does not establish a cross-service backup
barrier, credential-epoch reset, current-authority reconciliation, hosted
disaster restoration or production traffic capacity. The remaining
[hosted recovery gate](../recovery.md#hosted-recovery-release-gate) stays open.
