# Hosted repository recovery — 2026-10-28 JST

The isolated repository drill passes at implementation
`4ce6a4e5e3cba640adda2e725e8f3a95a7910231`. It extends the
[native provider probe](native-recovery-validation.md) with real application
state, Git transport, policy enforcement and explicit reconciliation of known
current revocations after an older restore. The complete
[production recovery gate](../recovery.md#hosted-recovery-release-gate) remains
open for the limits below.

The live controller ran from `2026-10-27T22:35:47Z` to `22:43:39Z`, including
provisioning, two checkpoints, several phase deployments, the authority-hazard
exercise and cleanup. This duration is not an application RTO. The
[sanitized receipt](hosted-repository-recovery-receipt.json) omits provider
account identifiers, DO IDs/bookmarks, cookies and credentials. Detailed
checkpoints, R2 bytes, provider logs, the independent authority file and the
sanitized trace remain in the operator's private audit directory.

## Live checks

The ordinary request hold remains enabled in the isolated backend throughout.
Only a private, expiring, separately authenticated fixture transport reaches the
real application for seeding and verification. Its phase configuration lives
outside DO/D1/R2 backups. The frozen phase closes that transport as well;
provider login flows, WebSockets and live-stream paths are unavailable. No
production application bindings, provider secrets, repositories or dispatchers
are reused. The operator's Cloudflare deployment authorization is used only to
manage and observe the generated fixture resources and read main metadata.

Constructor registration captures **13 real DO instances across all nine
classes**, including internal RPC targets. Both checkpoints require a stable
inventory, no scheduled alarms, no open sockets, no unpublished object backlog
and no active import. Every R2 object is retained in private controller files
against independently held expectations. The fixture has 15 R2 objects totaling
18,660 compressed bytes, including its constructor inventory and Git pack/index.
The Git binary itself expands to 1,048,593 bytes.

The first checkpoint precedes revocations; the second follows them. A deliberately
corrupted retained file fails checksum verification before loss or restore writes.
The controller then physically clears all inventoried DO SQL/KV content, drops
the fixture D1 identity and CLI-credential tables, and deletes every R2 object.
It observes missing repository/API state, a missing Git address and empty D1/R2
content before restoration. This is content loss inside existing provider
resources, rather than namespace or infrastructure recreation.

The second checkpoint restores through native DO bookmarks and D1 Time Travel,
with verified retained R2 bytes restored before restarting real constructors.
Acceptance includes:

- Exact Git refs, reachable graph and tree; strict independent clone/fsck;
  binary bytes, executable and symlink modes, a Unicode branch and an annotated
  tag. The fixture contains three refs and ten reachable Git objects.
- Repository addressing, default branch, protection configuration, tag rules,
  policy audit, Room issue data, runner metadata and MCP work attribution.
- PR reviews and anchored hunk discussion, including the unresolved thread and
  zero eligible approvals from the removed reviewer.
- Exact D1 identity/CLI rows and complete R2 key, byte-count and checksum
  comparisons at the checkpoint.
- Rejected direct push to protected main, rejected creation under a locked
  branch pattern, rejected release-tag deletion and rejected unready PR merge.
  These use actual Git transport and application authorization after restoration.
- Preserved archive state and rejection of a new issue in the archived repo;
  anonymous access to the private restored repository remains denied.
- Continued rejection of removed collaborator access and revoked Git,
  D1-backed CLI, agent/MCP and runner credentials. Forgotten synthetic Account
  tokens remain unavailable.

The Git commands use ordinary Git HTTP transport. MCP calls use the official
TypeScript client against the actual application endpoint. CLI credential checks
use the native HTTP API; this drill does not rerun every packaged `nh` command.

## Older-backup authority and reconciliation

Restoring the first checkpoint deliberately revives the removed collaborator,
Git and CLI access, agent MCP access, the runner registration and synthetic
Account tokens inside the private fixture. This confirms that an old content
backup is insufficient authority for reopening traffic.

The controller reads the separately retained latest-authority file and replays
those known removals/revocations through the real administration APIs. It then
forces object restarts and verifies the removed account and every old credential
are denied again. Review history survives, but the removed writer supplies no
approval authority. The private operator transport ends frozen. **Normal traffic
is never reopened**, including while the authority hazard is being demonstrated.
Thirty-six normal-route hold checks pass across API, Git and GET/HEAD asset
requests, requiring the recovery marker, private no-store responses and empty
HEAD bodies.

This proves explicit replay for the fixture's independently known operations.
It does not implement a general current-authority ledger or discover unknown
production grants automatically.

## Independent observation and cleanup

Cleanup fences the gate, explicitly retires all nine DO classes, removes the
backend, purges all 15 R2 objects, deletes the bucket/database and removes the
gate. A separate observer confirms both Workers, the exact bucket and the exact
database are absent, checks the retirement receipt and verifies ingress keys and
the temporary repository-grant file were removed. The runtime trace contains
586 sanitized events with zero write failures.

The independent observer also reruns strict fsck on the retained verification
clone, compares refs, graph, tree and binary bytes with the source, and checks
the executable/symlink modes, Unicode name and annotated tag. A final read-only
production observation confirms main version
`993b659a-8d24-442b-92b4-f5270a94029a` still serves 100% of traffic with all 27
bindings, its 50,000-subrequest budget and the hold off. No main or Vault
deployment occurred.

Local acceptance passes pinned tsrs, 13 recovery-fixture tests, 19 existing
authority/lifecycle tests and five proxy/observation tests. Source is committed
locally and has not been pushed to GitHub.

## Remaining production requirements

The drill uses existing isolated namespaces and a constructor-generated opaque-ID
inventory. Production name reconstruction, namespace loss and independent
enumeration remain unproven. Controller files are retained backups for this
drill, not an operated long-term backup service. The fixture has no running jobs,
imports, open sockets or external RPC clients; it does not establish general
production draining or cross-service atomicity under concurrent traffic.

The known-operation authority file does not replace independently obtaining the
latest production owners, invitations, signing/check sources, credential state,
deployment leases and provider sessions. Vault/workload-grant recovery, retained
Cloudflare Secrets Store value references and rotation must be integrated into
the hosted workflow; no actual Secrets Store value is exported here. Synthetic
Account tokens are not Secrets Store values.

Full return-path operations, measured production RPO/RTO, safe public reopening,
traffic/security acceptance and the original application CI/staging/cutover
checks remain release gates. This passing drill strengthens private-beta
evidence without establishing broad production-traffic readiness.

The later [Vault-inclusive drill](hosted-vault-recovery-validation.md) adds the
separate service and workload-grant recovery on the same Git graph, including
a return to the current authorization/Vault checkpoint. Changing Git graphs
between checkpoints are a separate pending hosted gate.
