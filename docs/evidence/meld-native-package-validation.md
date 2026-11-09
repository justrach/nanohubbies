# Complete native Meld package acceptance — 2026-11-09

[Attempt 7](meld-native-package-attempt-7.json) passes the full isolated PR-head
flow on Nanohub `572f840`, using Meld main `e2388418` and candidate
`26d6aaee55bf1b17889a5602e27e63723ea81a62`. This is a local Nanohub fixture
with real Codegraff execution, not hosted dispatcher or staging acceptance.

The run imports 18,248 Git objects and the supplied main ref, verifies strict
fsck, revokes its import/Git credentials and rejects further access. This is full
main history; it does not claim all upstream branch refs were re-imported.

All nine workflow steps pass: isolation, frozen offline install, 40 policy/guard
tests, pinned-tsrs checks, 4,254 API/web/extension cases, Chrome availability,
471 browser cases, production bundle and pinned Wrangler package. There are
205 unit/package and 73 browser skips. Skips and mocked behavior are not
real-service acceptance.

The 41,683,071-byte export contains four modules, 306 assets and its descriptor
(311 files). The canonical consumer accepts the exact run, attempt, head, base,
image and VM provenance, verifies every blob and the committed wrapper, and
requires confirmed cleanup. The VM is independently observed destroyed.

Direct/forced/default-branch deletion attempts are rejected. A PR is blocked
before CI and still blocked for missing staging after CI passes. A newer retry
invalidates the old success; the fixture's final attempt is intentionally queued.
Runner revocation is verified and the fixture is closed. These receipts cannot
be reused as current deployment authority.

The uploader also refuses this real canonical package against current staging
history `194a45ea`, without retrieving credentials or writing to the provider.
The [private integration proposal](meld-integration-proposal-validation.md) is
the next candidate to check; a PR-head pass cannot substitute for that check.
