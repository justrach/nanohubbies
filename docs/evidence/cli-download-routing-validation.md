# CLI download routing correction — 2026-10-31

This is a **source correction, not yet deployed**. Production remains the
[reader feedback release](reader-feedback-release-validation.md), CLI 0.4.21.

The release check exposed an unknown canonical CLI module URL returning a Next
HTML not-found page with HTTP 200. The web Worker now serves download routes
exclusively through ASSETS, retaining missing-file 404 and upstream error status.
Errors use private/no-store; supported GET/HEAD responses retain nosniff, and
HEAD is bodyless. Unsupported methods return 405 with Allow: GET, HEAD. A missing
ASSETS binding returns retryable private 503. Recovery hold still runs first.

The route guard covers install.mjs, latest.json and versioned module/checksum
paths, including trailing slashes and query strings. It does not reserve the
entire `/nh/` prefix: `nh` is a valid owner handle. Owner/repo routes and CLI
authorization retain application routing. Existing API/Git/static/legacy routing
remains covered by the same actual-entrypoint tests.

Local evidence:

- Compiling the previous and candidate actual Worker against the same synthetic
  Next/ASSETS delegates reproduces HTTP 200 HTML before and HTTP 404 plain text
  after at `/nh/releases/999.0.0/nh.mjs`. This is a local diagnostic, not a new
  production observation.
- Three actual-handler unit tests pass, including missing download GET/HEAD,
  rejected methods, absent/failed asset service, legacy exclusion and preserved
  owner/repo routes.
- The real Miniflare asset router passes exact installer/module/checksum/manifest
  bytes, missing versioned downloads, queries/trailing slash, successful and
  missing HEAD, methods, application routes, held/malformed configuration and
  reopening. Extensionless checksum assets have no Content-Type in this fixture;
  an initial test incorrectly expected one and was corrected to preserve the
  binding's metadata. No production MIME behavior is changed.
- `bun run check` passes the operator checks and pinned tsrs tasks. The portable
  CLI remains 101486 bytes, SHA-256
  `b7b663508a22af420f74ec4caaf16690c9fefb5ba49b2405459bd5452df5885e`.

No CLI version bump or published byte change is needed. Full frozen release
build, isolated cloud delivery and production routing acceptance remain required
before claiming this correction is deployed. The original failed release guard
and the subsequent valid 0.4.21 publication evidence remain unchanged.
