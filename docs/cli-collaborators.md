# Repository access from the CLI

Local CLI **0.4.16** adds collaborator administration for independently managed
repositories. This version and its server changes are not published/deployed yet;
the current public CLI remains 0.4.15. Existing browser invitation/acceptance
flows continue to work. Externally managed Codegraff teams keep their provider
membership boundary and cannot be overridden through these commands.

## Commands

Authorize the separate `collaborators:write` permission explicitly. It never
joins default CLI login scopes. Both the browser's consent and every operation
require your current owner/admin role; archive blocks new grants and edits.
An existing grant may inspect access while archived. Only the owner can invite,
change or remove admins. The owner cannot be changed or removed here.

```sh
nh auth login -R owner/repository --scopes read,collaborators:write
nh access list -R owner/repository --json
nh access invite codegraff:ACCOUNT -R owner/repository --role writer \
  --revision 6 --invite-file /absolute/private/invitation.json
nh access recover -R owner/repository --invite-file /absolute/private/invitation.json
nh access role codegraff:ACCOUNT -R owner/repository --role reader --revision 9
nh access remove codegraff:ACCOUNT -R owner/repository \
  --revision 10 --confirm codegraff:ACCOUNT
nh access cancel INVITATION_ID -R owner/repository \
  --revision 11 --confirm INVITATION_ID
```

Use the actual revision from `access list`, not the example numbers. Roles are
`reader`, `writer` and `admin`. Account IDs are exact Nanohub IDs, available from
the recipient's signed-in People page or `/api/auth/me`; email/handle lookup is
not implemented. Ordinary repository roles and protections still apply to Git,
PRs and reviews. This permission does not grant runner or secrets administration.

## Private invitations and recovery

The CLI generates a unique invitation ID and `nhi_` token and saves an owner-only
JSON file **before** the POST. The file contains an `acceptUrl` for the existing
browser invitation page. Share that URL privately with the intended recipient.
They must sign in as that exact account and explicitly accept. The token stays
in the URL fragment; it is not sent as a page query or printed by the CLI.

Keep invitation files outside Git checkouts. Creation is exclusive (no overwrite)
and mode 0600; recovery rejects files that are readable by others, oversized,
symlinked, not regular files, owned by another OS user, or for another host or
selected repository address. The server also binds the immutable repository ID,
original inviter, recipient, role and token hash. CLI output and server metadata
never contain the invitation token or acceptance URL.

If a response is lost, inspect `access list` and explicitly use `access recover`
with the saved file. It may finish a prepared invitation that was never created,
or recover the exact still-pending invitation without a duplicate or expiry
extension. It does not resurrect an accepted, canceled or expired CLI invitation,
including after the recipient was subsequently removed. These checks use a
retained recovery record; deleting the local file does not cancel the invitation.
Use `access cancel` for that. No mutation is automatically retried.

Invitations retain their seven-day lifetime independently from the CLI credential
that issued them. Revoking that credential stops further CLI operations but does
not cancel its pending invitations. Acceptance still rechecks the inviter's
current role, archive and intended recipient. Demotion/removal cancels invitations
involving that account, following the existing browser behavior.

## Conditional writes and audit

The bounded gateway exposes GET/POST/PATCH/DELETE only at
`/api/cli/trunks/:id/collaborators` or its owner/repo alias. All require
`collaborators:write` and current direct owner/admin membership; ordinary `read`,
Git credentials, agent credentials and runner credentials do not authorize it.
Direct browser APIs do not accept CLI bearer credentials.

GET returns members, unexpired invitation metadata, current role, archive state,
revision, capability flags and the latest 50 access audit entries. Mutation bodies
are bounded to 4 KiB and reject unknown fields. They require a body `revision`
and matching `If-Match: "collaborators-N"`; missing conditions return 428,
malformed conditions 400 and stale writes 412. Exact invitation recovery still
requires a condition, but can return its existing record after unrelated edits.

The Hub checks current membership and archive inside the final synchronous
transaction. SQL triggers advance revisions for collaborator, invitation and
team-binding insert/update/delete operations, covering browser and older RPC
writers too. The revision schema's SQL initialization marker survives restart
and rolls back with the surrounding transaction. Access audit entries retain
actor, target, action, time and the issuing CLI credential ID, never tokens/hashes.

Admins can change a collaborator to their existing role using the same existing
store semantics: this also invalidates invitations involving that account.
Only invoke a role change deliberately. Invitation expiry itself is time based;
it need not advance the storage revision until a stored row is changed/removed.

Old servers/receivers without the versioned capability fail closed. There is no
fallback to browser issuance or automatic write retry. Persistent recovery
records currently have no pruning policy. Account-wide CLI grants, organizations,
ownership transfer, email invitations and GitHub's complete role/API model remain
open. Restoring an older backup still needs the project's latest-authority
reconciliation before reopening; these records do not solve that release gate.

Run `bun run --filter @swarm/api test:cli-collaborators` and
`bun run test:cli`. See [acceptance evidence](evidence/cli-collaborators-validation.md).
