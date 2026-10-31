# Secret references and workload grants in the CLI

Candidate **0.4.18** adds native `nh secret` / `nanohub secret` commands. Local
acceptance passes; cloud release validation and rollout are pending. The current
public CLI remains 0.4.17. See [validation](evidence/cli-secrets-validation.md).
The commands are also included in candidate **0.4.19**, alongside
[requested reviewers](review-requests.md); neither candidate is a published release.

Nanohub manages references to values retained in Cloudflare Secrets Store. These
commands do not accept, upload or print Cloudflare secret values. Create or
rotate values through Cloudflare, then connect an offered binding reference.
Disconnecting a reference, revoking a grant and runtime idling retain the saved
Cloudflare value. [Provisioning and custody](access-and-secrets.md) remain the
same.

## Permissions

All three capabilities require your **current repository owner/admin role**:

| Permission | Authority |
| --- | --- |
| `secrets:read` | Reference names/bindings, grant metadata and audit; no values |
| `secrets:write` | Connect/disconnect references using the observed revision |
| `secrets:grant` | Issue/revoke workload grants for selected names |

The write/grant capabilities also require metadata permission. They are absent
from default login and existing credentials. Browser consent displays each
requested capability and its effect. For example:

```sh
nh auth login -R your-handle/app --scopes secrets:read,secrets:write,secrets:grant
nh secret list -R your-handle/app --environment staging --json
nh secret connect DEPLOY_TOKEN --binding OFFERED_BINDING --revision 0 -R your-handle/app
```

Use the actual binding and revision from `secret list`. Secret names and binding
names are case-sensitive. The default environment is `staging`; custom names use
lowercase letters, digits and hyphens. Repository/environment/name isolation is
checked against the deployed Cloudflare binding allowlist. Admin access cannot
connect another repository's binding.

## Private workload grants

```sh
nh secret grant DEPLOY_TOKEN --revision 1 --ttl 900 \
  --token-file "$HOME/.config/nanohub/staging-workload.json" -R your-handle/app
nh secret recover --token-file "$HOME/.config/nanohub/staging-workload.json" -R your-handle/app
nh secret revoke GRANT_ID --confirm GRANT_ID -R your-handle/app
nh secret disconnect DEPLOY_TOKEN --revision 1 --confirm DEPLOY_TOKEN -R your-handle/app
```

The file's parent directory must exist outside any Git checkout. Creation is
exclusive, owner-only and flushed before the issuance request. Existing files
are never overwritten. Recovery rejects symlinks, files readable by other
users, oversized files and a different host/repository/environment/parent CLI
credential. Up to 100 selected names fit the bounded 32 KiB grant document.

The private document contains an immutable repository ID, exact `readUrl`,
environment, grant ID/credential, selected names, parent credential ID and fixed
expiry. It contains neither the parent CLI bearer nor Cloudflare values.
Give this file only to a trusted controller/workload. That workload can POST to
`readUrl` with the document's grant credential as its Bearer token to receive
the selected values over HTTPS. Candidate builds receive no grant automatically.
The CLI prints metadata and the file path, including with `--json`; the grant
credential never appears in output or API metadata.

`--ttl` requests 60–3600 seconds (default 900), measured from server metadata and
including local file/request time. Expiry is capped at the issuing CLI
credential's expiry. Each grant permits at most 100 redemptions. Issuer demotion,
parent CLI expiry/revocation, reference disconnection, repository archival or
grant revocation block access. The service rechecks role/delegation and the
grant/reference state before delivering values; responses are private/no-store.

Lost mutation responses are never automatically replayed. Keep the private
file and use `secret recover` for the same grant. Recovery preserves ID, issuer,
parent credential, names, hash, expiry and consumed-read budget. It never
extends expiry or recreates a revoked, expired, exhausted or disconnected grant.
A new CLI credential cannot take over the saved grant; it can revoke the old
grant using its ID and issue a new one through a new private file.

## Revisions, archival and runtime

Reference writes require `If-Match: "secrets-N"` at the API. Storage triggers
observe legacy UI writes as well as CLI changes, so a stale revision returns
412 without overwriting current references. Plaintext `value` fields and unknown
fields are rejected. New grant creation also binds the observed reference
revision; an acknowledged active grant can be recovered with its original
revision.

Archived repositories permit metadata reads and grant revocation. New grants
and reference edits remain blocked at the gateway and final authority check.
Admins can authorize metadata/grant permissions while archived for revocation;
reference-write permission is unavailable until reopening.

The Vault stores only references, hashed credentials and audit/recovery metadata.
Recovery receipts are bounded to 1,000 unexpired operations per environment and
pruned opportunistically. A revoked receipt remains until its fixed expiry to
prevent resurrection, but does not schedule an alarm. When no active grants
remain, the cleanup alarm is cleared. Cloudflare controls runtime eviction;
there is no keepalive loop and no claim of a specific eviction time.

## Protocol and rollout

CLI-issued workload credentials use **`nhw_`**; existing browser-issued grants
retain `nhv_`. Older API/Vault implementations reject the new format, including
after rollback. The current Vault additionally refuses legacy RPC redemption of
delegated grants. A missing delegation receipt fails closed.

New administration and redemption use private RPC authority callbacks. Captured
bindings and identities are JavaScript-private; the callback returns only a
short-lived scalar authorization. The final writer checks the current role and
D1 delegation, then commits metadata synchronously. RPC capabilities are scoped
to the call rather than retained as idle work; see the
[Cloudflare RPC lifecycle](https://developers.cloudflare.com/workers/runtime-apis/rpc/lifecycle/).
Missing protocol methods return unavailable/denied; there is no legacy fallback
for CLI administration or delegated redemption.

Deploy the compatible private Vault before the API/CLI release, retaining its
complete existing binding manifest and Cloudflare values. Schema additions are
metadata-only and preserve legacy references/grants. API rollback can deny new
commands/grants safely; older Vault code rejects `nhw_` credentials. Production
recovery must still reconcile current CLI authority and grant metadata; a
complete rollback of authority data can resurrect old permissions, as described
in the [recovery contract](recovery.md). This feature does not close that release
gate or activate the hosted Actions fleet.
