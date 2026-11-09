# Atomic repository admission release — 2026-11-09

Worker `64bda897-a8ba-4834-a98c-7b68c380a33f` now serves 100% of Nanohub
production traffic from published source
`4e781528f6b99d2ff3b17300a66b8d1913ac1be4`. The
[admission correction](namespace-admission-validation.md) reserves a new
repository's address and quota capacity in one Hub transaction. A definitive
quota refusal leaves the name retryable; uncertain initialization retains its
original identity. Quota limits are unchanged.

The [release receipt](namespace-admission-release-receipt.json) records:

- All nine frozen Linux gates, including 554 API cases, 103 CLI cases, the real
  Worker/Git/protection/review/recovery chain, Vault, hosting, fixtures, production
  build and three uncached pinned-tsrs workspace checks. The job uses the retained
  digest-pinned toolchain without network or candidate control credentials.
  A separate provider read confirms destruction of its disposable VM.
- A frozen Mac OpenNext build and production-configuration Wrangler dry run,
  with 1,271 source files and 1,480 built files verified against saved hashes.
  All 21 published CLI releases and their checksums are retained.
- A disposable Cloudflare Worker with only asset and version-metadata bindings:
  50 exact normal asset comparisons, 60 private/no-store recovery-hold responses,
  bodyless held HEAD and 16 routing checks in each mode. Exact provider reads
  confirm its absence after deletion and again before production staging.
- Normal and held production versions staged before promotion. All 27 normal
  binding definitions, Worker-first assets and the 50,000-subrequest limit are
  preserved. Held version `45ca7bc6-6ca4-4e26-b714-0f641c680dbb` adds only the
  recovery-hold variable and receives no traffic.
- One traffic-promotion command, followed by independent provider deployment
  observation and a matching public version endpoint. Unknown mutations are
  not automatically replayed by the controller.
- 58 exact public asset comparisons, 16 public routing checks and a temporary
  installation of both `nh` and `nanohub` at 0.4.21 outside the checkout. The
  temporary installation is removed; the global installation is unchanged.
- Fourteen exact authenticated before/after canary comparisons: branches,
  protections, rulesets, default branch, archive, environments, collaborators,
  secret references, runners, PR, comments, requested reviewers, CLI credentials
  and Git tokens. No credential is issued or repository setting changed.
- An independent post-release provider read confirms Vault remains on
  `0dbd5e74-5c41-428f-bc6a-2e8d3ecaef48`; it is not redeployed.

This release does not repeat production repository creation or prove a valid
hosted deployment-authorization flow. The full authorization procedure passes
local Worker/CLI acceptance with preserved existing repository state; its
browser-issued production credential remains unissued pending the browser
tool's action-time confirmation. Pre-existing orphaned or uncertain namespace
reservations are not repaired or removed automatically. The failed pre-fix
synthetic production name may still have such a reservation.

Hosted Actions activation, actual Meld schema reconciliation, coordinated live
staging acceptance and cutover, production recovery and load/operations gates
remain open in [production readiness](../production-readiness.md).
