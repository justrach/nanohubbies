# Collaborator CLI and shared capacity — Linux acceptance, 2026-10-29

The frozen runtime passes all eight full-project gates on a fresh Codegraff VM.
**CLI 0.4.16 is not published, and this runtime is not deployed to the main
Worker.** Disposable Cloudflare delivery acceptance remains incomplete, so the
release stops before production staging or promotion. The
[sanitized receipt](access-capacity-linux-receipt.json) records the separate
successful Linux gate, failed delivery probes, cleanup and current publication.

## Exact source and Linux execution

Runtime implementation `610e4c66b9402c91c1b1229e0575c1122ce6ab1b` is copied into
credential-free acceptance commit `520a91a55548ef9307744ca50398f0931fc908bd`.
All 1,024 copied files match the working tree at verification. Private deployment
configuration, controller credentials and artifacts are outside that source.
The evidence files added by this record are subsequent documentation and are
not part of the acceptance commit.

The retained private Cloudflare toolchain image is pinned to
`sha256:76f35e83a77df1d8eace6e8fc49b7f77d6dcd6d90bbaf40722c5c5f9f8bd6694`.
The trusted controller obtains temporary pull access; candidate execution has
no control credentials, network access or Docker socket. Bun 1.4.4 and Node
24.14.1 are verified. Neither npm nor npx is available to the candidate.

All eight gates pass, ending at `2026-10-29T09:38:53.719Z`:

| Gate | Command |
| --- | --- |
| Frozen offline dependencies | `bun install --frozen-lockfile --offline` |
| API units | `bun run --filter @swarm/api test:unit` — 365 pass, zero failures |
| Repository integration | `bun run test:repository` |
| CLI units | `bun run test:cli` — 64 pass, zero failures |
| Access and Vault | `bun run --filter @swarm/api test:access` |
| Hosting and capacity | `bun run --filter @swarm/api test:hosting` |
| Production Next build | `bun run --filter @swarm/web build` |
| Operator configuration and pinned tsrs | `bun run check` |

The real repository chain includes Git, reviews/hunks, protections, native CLI,
archive and cold recovery. Access acceptance exercises both source and bundled
collaborator commands, current-role/scope checks, recipient-bound invitations,
lost-ack recovery, revocation, real clone/push denial, external-team isolation,
explicit device consent and audit attribution. Hosting acceptance races shared
reservations across repository Workers and verifies account/deployment limits,
replay fencing, restart persistence and cleanup after archive. These suites
overlap; their case counts must not be added together.

The dispatcher uses the corrected bounded source-transfer implementation,
verifies the reconstructed bundle and exact head, and completes execution.
This closes the fresh-Linux gate left open in the earlier
[upload diagnosis](runner-upload-validation.md). Fault-reconciliation cases
remain separately established by local protocol tests; the successful cloud
run does not establish that every fault branch occurred live.

The VM is destroyed by the controller. An independent provider read at
`2026-10-29T09:40:02.837Z` confirms `destroyed`. The complete OpenNext build and
production-configuration Wrangler dry run also pass.

## Delivery acceptance remains incomplete

Five uniquely named disposable Workers use the actual application entrypoint
and built assets, with only asset/version-metadata bindings. They have no
production storage, service bindings or custom domain. None completes the
required 17 exact normal asset comparisons and 23 held-route checks.

The first two deploy commands do not report a deployed version before cleanup.
A later attempt reports a script-upload connectivity failure. A fourth obtains
a provider-confirmed deployment but its first `/nh/latest.json` read returns
404; its cause and propagation bound are not established. The final attempt
fails during upload, then provider observation and initial cleanup encounter
connectivity/DNS failures. The controller retains that unresolved cleanup
receipt. A later provider read observes the exact owned temporary Worker; it is
deleted and absence is independently confirmed. All five exact names are
subsequently checked absent with provider error 10007.

Private release controllers now distinguish an interrupted command from a
successful upload, reconcile deployment identities through provider reads, and
record bounded normal/held readiness observations. These changes do not waive
byte/MIME comparisons or hold enforcement. They have not yet produced a passing
delivery receipt. Wrangler itself can retry HTTP requests internally; this
record does not claim zero transport retries or establish a provider root cause.

No normal or held production version is staged, and no traffic promotion is
attempted. No production CLI credential, collaborator invitation, Git ref or
repository setting is created or changed by this acceptance.

## Current publication and remaining gates

Fresh public/provider reads retain main Worker
`31d951d3-6a6d-4784-aeaf-34c39995733b` at 100%, CLI 0.4.15 with its original
SHA-256, all 27 binding definitions, Worker-first assets and the 50,000-subrequest
budget. The production request hold remains off. Vault remains on
`02dcb88b-5c99-49d9-a4b6-cb95451e6bb5`; it is not redeployed. A read-only signed-in
CLI-consent baseline has zero credentials and 13 scopes, without the new
collaborator scope. No permission is granted through that read.

A fresh check of the configured Nanohub Actions key still returns HTTP 403 for
missing sandbox scope, making one provider GET, zero Nanohub requests and zero
allocations. The separate trusted CI account proves isolated Linux execution;
it does not replace the Nanohub key or activate hosted callbacks/dispatch.

Disposable delivery, inactive-version staging, exact production publication and
live post-release preservation checks remain required for CLI 0.4.16. The wider
goal also retains unattended Actions, intended-application CI/staging/cutover,
complete changing-Git hosted recovery, load/security/operations and broader
GitHub parity gates in [production readiness](../production-readiness.md).
Source is committed locally and has not been pushed to GitHub.
