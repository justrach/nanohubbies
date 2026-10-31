# CLI download routing release — 2026-10-31

The server correction is deployed. Missing versioned CLI downloads now retain
the asset service's **404**, rather than falling through to a Next HTML page
with HTTP 200. CLI **0.4.21**, its installer and all 21 published module/checksum
pairs are unchanged. See the [receipt](cli-download-release-receipt.json),
[public checks](cli-download-public-checks.json) and
[initial implementation evidence](cli-download-routing-validation.md).

## Behavior and observed production result

Install, manifest and versioned module/checksum routes use ASSETS exclusively.
Successful downloads retain public revalidation and nosniff. Error responses
are private/no-store; HEAD is bodyless. Unsupported methods return 405 with
Allow: GET, HEAD. An absent ASSETS binding returns retryable 503, verified locally
without removing a production binding. Recovery hold runs before all routing.
Other owner/repo URLs remain application routes; the entire `/nh/` prefix is
not reserved because `nh` is a valid owner handle.

The same nonexistent `/nh/releases/999.0.0/nh.mjs` URL was observed before and
after promotion:

| Observation | Before | After |
| --- | --- | --- |
| GET | 200, HTML not-found page, 19101 bytes | 404, empty asset-service body |
| HEAD | Not part of this baseline probe | 404, zero bytes |
| Error caching | Successful-response public revalidation | private, no-store |

The before-body SHA-256 is recorded in the receipt. The empty asset error has
no Content-Type; the correction preserves that metadata. It does not claim to
convert every asset failure into JSON or change unrelated application routing.

## Frozen source and gates

Runtime implementation is `d868a761bec14b2c652be4357376f33d92bc897b`.
Validated source is `59fa95f634f24af85261bfb1265a12e5fce10112`, including the
corrected routing fixture. All 1194 frozen source and 1480 built files match.
API, Vault, web client and CLI runtime sources are unchanged from the preceding
reader-feedback release. The only application runtime change is the web router.

The first cloud attempt stopped at the unit gate: 450 passed and one old fixture
expected Next delivery without ASSETS. Its artificial missing query also made
Next return 404, masking the real missing-file behavior. The fixture now supplies
ASSETS and checks its bytes/404 plus absent-binding 503, with Next independently
returning 200 for ordinary requests. All 451 API cases passed locally before the
second frozen run. The failed run and its independently destroyed VM are retained
as failed evidence; they are not counted as acceptance.

The second fresh Codegraff VM passes all nine gates: frozen offline Bun install,
API unit, complete repository/real Git/recovery, CLI, access, hosting, fixtures,
production build and pinned tsrs. Results include 451 API and 103 CLI cases,
three fresh typed tasks with zero cached tasks, real Worker-first asset routing
and the exact published CLI's reader workflow. The VM is independently confirmed
destroyed. Candidate execution has no external network, control credentials or
Docker socket. Exact searches for the two configured Codegraff keys find neither
in 2674 source/built files; this is not a general secret audit.

## Disposable delivery and production promotion

An asset-only Worker, with no production resource bindings or custom domain,
passes 50 normal asset comparisons and 16 routing checks. Its held version passes
60 GET checks and 16 routing checks, including missing files, methods and
bodyless HEAD. Held responses are private/no-store 503 with Retry-After 60.
Deletion and independent provider absence are confirmed before staging.

The provider confirms main Worker
`0b68079f-c6cf-4c0d-bf5d-92082fd354b5` at 100%; the live version endpoint
matches. Held version is `97a65949-5916-4636-b47f-2f137042e6ea`. Previous main
is `b3298aee-d026-4a79-8407-ee8071b5c776`. All 27 normal bindings, Worker-first
routing and the 50000-subrequest limit are preserved; held adds only its flag.
Vault is not redeployed and remains `0dbd5e74-5c41-428f-bc6a-2e8d3ecaef48`.
There are no automatic mutation retries after uncertain responses.

Production passes 58 exact asset comparisons, including all built stylesheets,
selected scripts/fonts and all 21 published CLI modules/checksums, plus all 16
routing checks. Fresh temporary installations of both `nh` and `nanohub` execute
0.4.21 outside the checkout from a prefix containing spaces and an apostrophe.
The temporary installation is removed; the global installation is unchanged.
The CLI remains 101486 bytes, SHA-256
`b7b663508a22af420f74ec4caaf16690c9fefb5ba49b2405459bd5452df5885e`.
No version bump or catalog change occurs in this release.

## Repository preservation and limits

All fourteen authenticated resources match exactly before staging, immediately
before promotion and after rollout in the existing private synthetic repository
`rachxpradhan/prod-codeowners-20261027`. Its seven refs, six reviews, eight
comments, eleven CI runs, policies/rulesets, default branch, archive state,
environments, collaborators, secret metadata, runners and request history remain.
There are no new Git/CLI credentials, Git writes or review writes. The pending
review is null and both credential inventories remain empty.

The rendered production PR still disables author Approve/Request changes and
Merge. Eligible approvals remain zero; two CODEOWNERS groups and the required
deployment remain unsatisfied. The canary has no Vault references/grants or idle
cleanup alarm; saved secret values are neither read nor changed.

At 07:49 UTC, the intended Nanohub Actions account still returns HTTP 403 /
`sandbox_scope_required` on one read-only provider request, with zero claims or
allocations. The separate existing CI credential runs only isolated acceptance.
Hosted dispatcher activation, actual application staging/cutover, production
recovery/load/operations and remaining GitHub parity work stay open. This release
does not establish general production traffic readiness.
