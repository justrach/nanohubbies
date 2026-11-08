# Bounded larger Actions source transfers — 2026-11-09

The freshly copied Meld main `8554f69acf4a0936ccacb3b4b9b3e0f8147796d8`
has a complete HEAD bundle of 372,270,805 bytes. The earlier fixed 64 MiB gate
would reject it before execution. This observation is sizing evidence, not a
successful cloud transfer or application CI result.

Trusted host configuration now selects `maxSourceBundleBytes` up to 1 GiB and
`sourceTransferConcurrency` from 1 to 8. Defaults remain 64 MiB and one upload.
Invalid settings fail before account access/claim; actual bundle size is checked
before allocation, including direct job calls. Candidate workflow declarations
cannot increase these limits. Native Meld acceptance selects 512 MiB/four uploads.

Each upload still carries at most 64 KiB. Completion order cannot reorder the
selected-path manifest. A failed worker stops further claims and every issued
upload settles before assembly or destruction. Existing checksum, immutable
staging-path reconciliation, lease cancellation and VM cleanup requirements
remain. Receipts include source length, SHA-256 and upload concurrency.

Local evidence:

- 479 API unit cases pass; 58 hosting cases and the real Worker capacity and
  namespace/Git integration pass.
- 51 focused runner/backend cases pass on Node and Bun. Subsequent strengthened
  dispatcher assertions pass on Node, proving config propagation and rejection
  before allocation. A real Git binary fixture reconstructs/clones/fscks after
  parallel uploads and a delayed abandoned write. Other cases force reordered
  completions, upload failure with siblings in flight, bounded concurrency and
  cleanup ordering.
- Pinned tsrs passes three tasks, two fresh and one cached, plus the operator
  binding preflight. The native harness has syntax/binding checks and exits
  before dispatch without explicit opt-in; full harness typing is not claimed.
- Five native-plan cases pass on Node/Bun, including reviewed pipeline identity
  and refusal of unreviewed changes. The fresh source's pipeline only changes
  Chrome download preparation; lockfile/dependency declarations remain compatible
  with the [reconciled private image](meld-native-image-reconciliation.json).

The subsequent [full-size loopback HTTP transfer](large-source-transfer-full-receipt.json)
passes on the complete 372,270,805-byte bundle: 5,688 uploads, four concurrent
requests, maximum JSON payload 87,538 bytes, matching assembled SHA-256, exact
HEAD/tree and strict fsck across all 18,102 reachable objects. Abandoned/local
transfer copies are removed. Candidate execution is deliberately refused and
the runner reports Failure; no successful CI result or cloud allocation is
fabricated. This closes full-size local transport acceptance only.

The [real native attempt](meld-native-preflight-failure.json) fails at the
read-only account preflight with sandbox-list HTTP 503 (`service_unavailable`,
Retry-After 2). A fresh known-VM read still confirms the old builder destroyed;
normal and bounded-list probes return 503. No repository fixture, native run,
credential or VM is created by that attempt, and original source refs remain
unchanged.

Actual cloud 355 MiB transfer, offline application suite, native callback, feature
workflow replacement refusal and independent job cleanup remain required.
No hosted dispatcher activation, staging deployment, production deployment or
application cutover is established by this local evidence.
