# Native Cloudflare recovery — 2026-10-28 JST

The isolated native provider probe passes at implementation
`9a71ad177f55c8a64cb88f26acfc657403db79fc`. This closes the provider-primitives
prerequisite, while the full [hosted repository recovery gate](../recovery.md#hosted-recovery-release-gate)
remains open. No production data was restored or changed.

The probe ran on fresh Cloudflare resources from `2026-10-27T22:23:39Z` to
`22:25:45Z`, including provisioning and cleanup. The native recovery checks
themselves took **61,620 ms**, which is a probe duration rather than an
application RTO. The private operation receipt, provider logs, checkpoints,
sanitized trace and independent observations remain in the operator's private
audit directory. The [public receipt](native-recovery-receipt.json) omits ingress
keys, provider account identifiers, object IDs and bookmarks.

## Verified on the actual provider

- All nine real application classes—Sequencer, Agent, Room, Driver, Hub,
  ImportJob, Account, Lane and Packer—retain exact SQL and typed KV data through
  native bookmark recovery after `deleteAll()`. Each restores checkpoint A,
  restores the provider's undo bookmark back to the observed empty state, then
  restores newer checkpoint B after explicit session restarts.
- SQL verification includes binary bytes, Unicode, an embedded NUL and the exact
  maximum signed 64-bit integer represented as text during comparison. Typed KV
  byte arrays survive. The fixture objects have no scheduled alarms.
- The isolated D1 database loses its fixed test table, restores checkpoint A,
  exercises the provider return bookmark and returns to checkpoint B through
  actual Wrangler Time Travel calls. Each read goes to the primary.
- A 1 MiB R2 object survives retained-file recovery with exact byte comparison.
  Deliberate corruption of the retained file fails an independently held checksum
  before a restore write; the newer live bytes remain unchanged after refusal.
  Deletion is observed explicitly before restoration. A return to newer bytes
  also passes.
- **48 held-response checks** cover API requests, Git discovery and GET/HEAD
  asset paths across phases. They require HTTP 503, the recovery marker, private
  no-store headers, retry guidance and an empty HEAD body.
- The backend has no external service bindings or public workers.dev route.
  The private gate targets only its owned backend. Deployed metadata requires
  the recovery hold and binds only the generated resources. Ordinary application
  traffic is never reopened during this probe.

The live controller records acceptance before cleanup. Cleanup fences the gate,
deploys the explicit nine-class deletion migration, removes the backend,
purges/removes R2, deletes D1 and removes the gate. A separate observer confirms
both Workers, the exact bucket and the exact database are absent, checks the
retirement receipt, and verifies the private ingress key files were removed.
Expected provider “missing resource” responses are required for absence;
authorization failures do not count. The sanitized runtime trace contains 175
events with zero write failures.

Local `bun run test:hosted-recovery` passes pinned tsrs and seven tests covering
RPC authority, malformed markers/bookmarks, deployed hold enforcement, bounded
control input, fixed R2 keys and retained-checksum refusal. The existing hosted
fixture suite passes its 19 lifecycle/authority tests and four proxy/observation
tests. The live result, rather than those local mocks, establishes execution of
Cloudflare PITR.

The shared controller's default Git-import mode also passes a fresh isolated
hosted regression at the same implementation: two branches (including a Unicode
name), one annotated tag, binary bytes and eight Git objects. Exact packaged CLI
0.4.12 imports and independently verifies the graph, resumes with zero object/ref
writes, preserves the source and denies the revoked credential with HTTP 401.
No agent is registered. Cleanup and a separate observer confirm every owned
resource is absent and all nine classes were retired for this second fixture.
This small regression verifies the shared lifecycle change; the earlier complete
[Meld graph acceptance](hosted-import-validation.md) remains separate evidence.

A read-only production check confirms main version
`993b659a-8d24-442b-92b4-f5270a94029a` remains at 100% traffic, with all 27
bindings, a 50,000-subrequest budget and the hold off. No main or Vault deployment
was performed. Source is committed locally; it has not been pushed to GitHub.

## Limits

The instrumented classes contain their real schemas plus synthetic marker data.
This probe does not yet restore and enforce an actual repository's refs, locks,
reviews, credentials, deployment leases and current membership together. It does
not cover Vault recovery, long-term independent backup retention, complete
production object-name inventory, deleted namespaces, alarm/socket/job draining,
cross-service checkpoint consistency, independent current-authority recovery or
safe public reopening. The private R2 backup is a controller file. No broad
production readiness, RPO/RTO or whole-repository disaster recovery claim follows
from this result. The primary-host migration and CI/staging gates remain open.
