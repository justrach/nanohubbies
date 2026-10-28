# Runner access before CI claims

The dispatcher previously checked only that `CODEGRAFF_API_KEY` was present
before claiming a candidate. Missing provider scope was discovered after claim
and clone, and could be reported as a failed candidate check. The configured
Nanohub Actions key still fails a fresh read-only sandbox request with HTTP 403
and the provider's known `insufficient_scope` diagnosis.

Codegraff dispatchers now check access before `/ci/claim`, using the documented
[read-only sandbox-list endpoint](https://codegraff.com/docs/sandboxes).
Rejected authorization, missing scope, unparseable responses and connection
failures stop before any candidate lease, clone, sandbox creation or completion
callback. Error messages retain only the known diagnosis and bounded HTTP
status. Provider bodies, credentials and underlying error causes are excluded.

Concurrent repository workers share a single in-flight check. Success expires
after five minutes and failure after five seconds; key replacement selects a
new fingerprint. Clock rollback invalidates cached results. At most 16 entries
are retained, without credential values or account inventory. Ordinary provider
requests continue to authorize each operation. Explicit Docker and existing
trusted pipeline adapters do not acquire a Codegraff dependency.

## Validation

- Fifteen focused dispatcher/cache cases pass under both Node 24 and Bun 1.4.4.
  They cover concurrency, rotation/expiry, transient failure recovery, synchronous
  probe failure, bounded retention, redaction, claim ordering and backend scope.
- The hosting command passes 44 unit cases and the real Worker/Git namespace
  integration. Its gateway double now distinguishes list from create. With
  rejected scope the actual candidate and attempt remain exactly queued, no
  claim request occurs and no bundle or VM is created. Replacing the key then
  completes that candidate through the real controller/callback path with one
  VM and confirmed cleanup in the gateway fixture.
- The complete repository command passes 264 unit cases and its full native
  Worker/Git/CLI/review/protection/recovery acceptance chain.
- The complete API unit command passes all 340 cases.
- The project check passes pinned tsrs gates; API and web results are fresh,
  one unchanged Vault workspace result is cached. The JavaScript binding/syntax
  preflight now covers seven operator modules; it remains explicitly distinct
  from full JavaScript type checking.
- At `2026-10-28T15:41:22.495Z`, the actual configured Nanohub key is used through
  `runOnce`. A guard permits only the real gateway GET and intercepts any
  application request. The result is HTTP 403 / `sandbox_scope_required`, one
  gateway read and **zero Nanohub requests**. No VM or credential is created and
  the key is not replaced. This is live rejection evidence, not successful
  hosted candidate execution.

The [sanitized receipt](runner-preflight-receipt.json) retains source and private
log hashes. The first hosting attempt failed because the old gateway double
counted every `/sandboxes` request as allocation, including GET. The corrected
double models GET and POST separately; its stronger queued-state assertion and
subsequent complete hosting command pass. This was a fixture mismatch exposed
by the added read request.

Two later read-only Node requests to production return 200 and two to the
deleted owned test host return 404. These observations do not establish the
cause or resolution of the earlier recovery reset/timeouts. Full hosted
changing-Git recovery, unattended Actions on the Nanohub account, real
application staging, capacity/security/operations and cutover remain open.
No production application or Vault deployment changes in this work.
