# Hosted complete-graph import acceptance

The opt-in [hosted harness](../hosted-import-acceptance.md) runs the full app
bundle against disposable Cloudflare Workers, Durable Objects, D1 and R2. The
source is the same pinned private Meld graph used in local acceptance: 178
branches, 18,097 reachable objects and 621,196,033 expanded bytes. No primary
remote changes or application CI/staging deployment are part of this test.

## Observed failures

The first fixture reached the real app and passed binding isolation, but its
loopback proxy forwarded a Brotli header after Node had decompressed the body.
Discovery failed before any object upload. The corrected bridge removes stale
encoding and length headers; real gzip and Brotli forwarding now have regression
coverage. Independent cleanup verification also caught Wrangler's partial R2
bucket inventory: its list omitted the newly created empty bucket. Recovery
removed that bucket and its recreated purge service. Exact bucket information,
including the provider's explicit missing-bucket response, now determines absence.
This run's namespaces, Workers, D1 and R2 are confirmed retired/deleted.

The second fixture uploaded all 18,097 objects, but final ref publication lost
its response at the five-minute request boundary. No successful publication or
independent clone is claimed. Explicit namespace retirement, bucket purge and
deletion of both Workers, D1 and R2 complete successfully. That failure shows
that local acceptance had not established hosted success; it does not establish
a Cloudflare CPU-limit diagnosis.

## Candidate correction

Implementation `a50c1ee` prepares the request's pack inventory once and allows
at most two concurrent graph reads with small incoming packs and the normal
16 MiB object limit. Larger incoming packs or configured object sizes retain
serial reads. Validation order, object IDs, types, canonical trees, paths, modes,
history, LFS/submodule rejection and object/byte limits remain enforced. Pending
reads drain on error. Nine regression cases compare complete traversal and
failure behavior with serial reads.

At that revision, local acceptance passes 306 API unit cases, 237 repository cases plus the complete
real Worker/Git/protection/recovery chain, 48 CLI tests, pinned tsrs and the full
OpenNext build. The CLI build also exposes and fixes a separate shared-output
race: CLI and web build tasks could truncate each other's distribution files.
Commit `858ff58` publishes complete files by atomic replacement; concurrent-build
coverage passes. CLI 0.4.12 retains its exact published 74,001 bytes and SHA-256
`7e86443cd1570ded5bcf9c6e95da5659a3a2506f11f6ade4d77238187881a0d3`.

The `a50c1ee` repeat also times out. Its provider trace records a canceled
invocation at 299,941 ms wall time, 3,234 ms CPU time, and R2 read progress of
3,000 calls at about 235.8 seconds. This is consistent with storage round trips
dominating elapsed time rather than CPU exhaustion. See Cloudflare's
[CPU and wall time definitions](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).
An independent authenticated read during publication sees zero refs in 1,078 ms;
no partial branch set is observed. The fixture's namespaces, Workers, R2 and D1
are confirmed deleted, with 858 sanitized trace events and no trace-write failures.

Commit `f00b78d` adds a request-scoped scan cache: packs up to 4 MiB can be reused
whole, with a 16 MiB byte budget and LRU eviction. Larger packs remain ranged.
Concurrent scan reads share a pack load; ordinary shared browse/agent readers
never share an in-flight I/O promise. Stored sizes are checked before allocation
and complete lengths afterward. Read-ahead now skips duplicate graph edges when
filling its two slots. All existing object and protection checks remain active.

The final candidate passes 314 API unit cases, 245 repository cases plus the
complete real Worker/Git/protection/recovery chain, 48 CLI tests, 23 fixture
checks, pinned tsrs and a full OpenNext build. Its hosted repeat **passes**; see
the [sanitized receipt](hosted-import-receipt.json).
The fixture retains the 50,000-subrequest budget, records numeric-only read
telemetry and provider timings without headers, credentials or arbitrary
console/exception text, and pins source commit, active resource bindings and CLI
bytes before upload. The harness checks zero object/ref writes on resume and
explicit HTTP 401 discovery after credential revocation.

## Hosted result and cleanup

All 18,097 objects upload in 160 bounded requests. One atomic publication exposes
all 178 refs. The completed publication invocation reports 221,463 ms wall time,
21,401 ms CPU time and 2,732 R2 gets, including pack inventory reads. Independent
mirror clone, strict fsck and all ref/tree/mode comparisons pass. A second native
CLI invocation repeats independent verification with zero object/ref write
requests. The source digest remains unchanged, no agents are registered, and
revoking the Git credential causes explicit HTTP 401 discovery denial.

The run spans 2026-10-27T18:21:21Z–18:35:53Z. Cleanup closes the gate, retires all
nine namespaces by migration, removes both Workers, purges 320 R2 objects,
deletes the bucket and D1 database, and removes private test keys. A second
observer confirms resource absence and the retirement receipt. Its first D1
observation receives a provider authentication error; a serial recheck succeeds.
The main Worker version and exact public CLI manifest/module remain unchanged.
The trace retains 1,598 sanitized events with no write failures.

This closes the pinned large-graph hosted migration gate for the candidate.
It establishes neither a traffic SLO nor actual application CI/staging or hosted
restore acceptance. No primary repository is cut over.

At this check, the main site remained on Worker
`9f7e3a05-e3d3-40d4-8b89-e4b53aac3739`. The later
[fresh Linux validation and production rollout](pack-scan-release-validation.md)
releases the correction as Worker `993b659a-8d24-442b-92b4-f5270a94029a`.
Actual application CI/staging, hosted recovery and traffic/security acceptance
remain release requirements. The Nanohub Actions account key is rechecked
read-only and still receives provider HTTP 403 for missing sandbox scope.
No other account's key replaces it.
