# Explicit owned-sandbox access probe — 2026-11-09

The gateway's sandbox-list route returns 503 while a previously owned builder
read still succeeds. An [independent live read](owned-sandbox-probe-receipt.json)
confirms the exact expected ID/state with Meld's sandbox-scoped key. The
configured Nanohub key without sandbox scope returns 403 / `insufficient_scope`
on that same route. This is a scope-enforced ownership observation, not proof
of available fleet capacity or successful execution.

Trusted runner configuration can explicitly select `sandboxAccessProbeId`.
The dispatcher then reads only `/v1/sandboxes/:id`, requires the exact returned
identity and a bounded state string, and discards unrelated provider metadata.
No default changes or automatic fallback are made. Missing/foreign records,
malformed identities/states, denied scope and transport failures stop before
capacity checks or CI claims. IDs cannot contain paths, query strings or URLs.
An owned destroyed tombstone can be used while retained; a retired record must
be replaced by an operator, never silently interpreted as success.

Cache identity includes both credential fingerprint and probe target. Listing
failure cannot contaminate an explicit probe; an owned read cannot authorize a
different key, ID or listing request. Existing expiry, single-flight, bounded
retention, safe error handling and per-operation provider authorization remain.

Validation:

- 485 API unit cases pass.
- 63 hosting cases plus actual Worker shared-capacity and namespace/Git
  integration pass.
- 23 focused preflight/runner cases pass on Node and Bun, including actual
  request routing/claim ordering, missing-scope denial, foreign/malformed reads,
  cache separation, path refusal and successful-JSON shape validation.
- Pinned tsrs passes three tasks, two fresh and one cached, plus operator
  binding checks. The native harness passes syntax/binding preflight; this does
  not claim complete JavaScript/harness typing.
- The real helper verifies Meld's known owned ID and still rejects the intended
  Nanohub key with 403 / `sandbox_scope_required`. No key is replaced and this
  verification creates no VM, repository, credential, CI result or deployment.

The native Meld harness passes the explicit trusted setting to both its startup
check and the actual dispatcher. Real allocation, private image delivery,
full-history source transfer, offline suite, authenticated callback and cleanup
still need their own acceptance. Prior list-preflight failures remain failed.
