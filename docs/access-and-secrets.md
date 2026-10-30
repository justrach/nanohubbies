# Repository collaborators and the vault service

Repository access and the private vault service are deployed. Hosted secrets lifecycle checks passed with an isolated synthetic Cloudflare-held value; see [the production receipt](evidence/production-validation-2026-10-26.md#hosted-secrets-lifecycle). No existing Meld credentials have been copied, replaced or migrated.

## Direct repository access

Open **People → Repository access** in an independently managed private repository. The recipient signs in and shares their exact Nanohub account ID (shown there, also available from `GET /api/auth/me`). The owner or admin chooses a role and creates an invitation. Deliver the link privately to that recipient; this implementation does not send email.

Invitations expire after seven days, require the intended signed-in account and explicit acceptance, and work once. The link keeps its token in the URL fragment. Only its SHA-256 hash is persisted. Cancel an invitation or remove/demote a collaborator from People. Demotion/removal invalidates that person's pending invitations and immediately changes the authority of their existing agent credentials. The original owner cannot be removed or changed by these controls.

| Role | Browse/clone | Push, PRs, reviews | Manage readers/writers, protection and secrets | Manage admins | CI runner administration, staging approval, delete repo |
| --- | --- | --- | --- | --- | --- |
| Reader | Yes | No | No | No | No |
| Writer | Yes | Yes | No | No | No |
| Admin | Yes | Yes | Yes | No | No |
| Owner | Yes | Yes | Yes | Yes | Yes |

Readers can register their own agent and obtain a credential for private Git clones. The credential inherits the owner's **current** role; it cannot push or submit work while that person has reader access. Sessions, Git HTTP downloads/pushes, HTTP writes, repository listings and live socket delivery/posting all check membership. Existing Codegraff-team repositories continue to use accepted Codegraff membership; direct invitations cannot override that boundary. Connecting an independent repo to a Codegraff room switches to that externally managed boundary and can remove existing local collaborators' access.

Endpoints (same-origin human session for management):

Published CLI 0.4.16 adds [scoped collaborator administration](cli-collaborators.md).
The browser/session endpoints below keep their existing permission model.

- `GET /api/trunks/:repo/collaborators`: members, pending invitations and current role.
- `POST` there: `{userId, role}` → invitation token shown once.
- `POST /api/invitations/accept`: `{trunk, token}`.
- `PATCH /api/trunks/:repo/collaborators`: `{userId, role}`; `role: null` removes.
- `DELETE /api/trunks/:repo/collaborators/:invitationId`: cancel.

## Separate secrets service

`packages/vault` is a private **nanohub-vault** Worker using [Cloudflare Secrets Store bindings](https://developers.cloudflare.com/secrets-store/integrations/workers/). Cloudflare retains and encrypts secret values. Nanohub has no root encryption key and accepts no secret-value writes. Each repository/environment has a separate SQLite Durable Object containing references, hashed grants and audit metadata. The API calls `VaultService` through a private service binding; the public handler returns 404 and workers.dev/preview URLs are disabled.

The runtime starts on demand and can idle when unused. There are no polling loops or recurring keepalive alarms. Active grants schedule a single cleanup alarm at their next expiration; exhausted/revoked grants remove that alarm when none remain. Management metadata includes `nextCleanupAt`: `null` means no cleanup alarm is scheduled. Runtime idling, grant expiry and disconnecting a reference **retain the saved value in Cloudflare**, as requested. Only explicit management in Cloudflare changes or deletes that value. Cloudflare controls runtime eviction; an empty alarm schedule proves eligibility to idle, not a specific eviction time.

A deployment allowlist binds each secret to an immutable repository ID, environment and name. An admin cannot connect another repository's binding. Owners/admins use **Settings → Secrets** to connect/disconnect available references, inspect activity and issue/revoke grants. Secret values are created and rotated directly in Cloudflare. Cloudflare's value management API is write-only; Workers resolve values through configured bindings. Static binding changes require a vault deployment. Rotation keeps the binding and needs no vault redeployment. Nanohub calls the provider for each read and does not cache values; immediate global propagation is not guaranteed by this implementation. The hosted check passed after a retry following an initial failed rotation probe.

Grants select names in one repository/environment, last 60–3600 seconds (UI: 15 minutes), and permit at most 100 reads. Only hashes are stored. Expiry, revocation, disconnected references, deleted repositories and an issuer losing owner/admin authority block redemption. Externally managed team ownership is reverified with Codegraff. Deployment operators and authorized grant holders remain trusted: a workload intentionally receives plaintext selected values over HTTPS. Cloudflare custody does not mean deployment operators cannot access them.

Endpoints support `?environment=staging` (default), `production` or a custom lowercase environment name:

- `GET /api/trunks/:repo/secrets`: names, references, configured choices, grants and audit; human owner/admin only.
- `PUT` there: `{name, binding}` connects a preconfigured Cloudflare binding. A `value` field is rejected.
- `DELETE` there: `{name}` disconnects a reference and revokes grants using it; the Cloudflare value remains. `{grantId}` revokes a grant.
- `POST` there: `{names: ["DEPLOY_TOKEN"], ttlSeconds: 900}` → `{id, token, expires}`.
- `POST /api/trunks/:repo/secrets/read?environment=staging` with `Authorization: Bearer <nhv_...>` → `{values: {...}}`. Sessions, agent credentials and CI lease tokens cannot redeem it.

Keep grants and returned values in a trusted deployment controller. Candidate Codegraff jobs receive no vault grants or deployment secrets automatically. This implementation does not migrate Meld's existing credentials.

Candidate CLI 0.4.18 adds [explicit secret administration](cli-secrets.md):
metadata/reference/grant permissions are separate and admin-only. Delegated
workload grants are stored in private local files, stop with their parent CLI
credential and cannot be resurrected by recovery. The source and bundled local
tests pass; rollout remains pending. Existing browser grants keep their current
independent lifecycle and Cloudflare retains values in both cases.

## Provisioning

1. In the intended Cloudflare account, create a Secrets Store and create its secret with the `workers` scope, using the dashboard or Wrangler's interactive prompt. Secret values never belong in a manifest, command argument or repository. For example:

   ```sh
   bun x wrangler secrets-store store list --remote --cwd packages/vault
   bun x wrangler secrets-store secret create STORE_ID --name repo-staging-deploy --scopes workers --remote --cwd packages/vault
   ```

2. Create a private JSON manifest containing **references only**. Use the repository's immutable `id` from the repository API, not its renameable owner/name address:

   ```json
   [{"binding":"STAGING_DEPLOY","storeId":"0123456789abcdef0123456789abcdef","secretName":"repo-staging-deploy","repository":"repo-actual-id","environment":"staging","name":"DEPLOY_TOKEN"}]
   ```

3. Generate a complete vault configuration from that manifest. The generator rejects value fields, ambiguous bindings, cross-repository sharing of one provider secret, duplicate names and invalid scopes. Keep the complete manifest for future binding changes; regeneration replaces the binding set.

   ```sh
   bun tools/cloudflare-secret-bindings.mjs /private/references.json packages/vault/wrangler.secrets.jsonc
   bun x wrangler deploy --config packages/vault/wrangler.secrets.jsonc --dry-run
   bun x wrangler deploy --config packages/vault/wrangler.secrets.jsonc
   ```

   The generated configuration is ignored by Git. Review it before deploying. The tracked empty configuration provides no secret bindings and fails closed for reads. Cloudflare account roles must permit Secrets Store management and binding; this service is subject to the platform's current limits.

4. Deploy the application with its `VAULT` service binding targeting `nanohub-vault`, entrypoint `VaultService`, in the same account. Both tracked application configs declare it; include it in private deployment configs and selected Wrangler environments (bindings are not inherited).
5. Connect the offered binding in People, issue a short test grant, redeem from a trusted workload, revoke, and verify subsequent redemption fails. Rotate the test value in Cloudflare and verify the next authorized read reflects it.

Local development uses Wrangler's **local** Secrets Store with synthetic values and a local generated config; it cannot read remote production bindings. Start the vault with that config and the API/web dev processes. The fixture automates this through Miniflare's actual Secrets Store provider, with separate API and vault Workers.

Legacy encrypted-value tables are left intact for owner-controlled migration and surfaced as `legacyValuesAwaitingMigration`. Old encryption keys are no longer read and old grants cannot redeem through the new service. Re-enter values from your trusted source into Cloudflare, verify the new references/workloads, then separately retire legacy data and keys under the owner's migration procedure. No silent data deletion or automatic decryption occurs.

## Verification

```sh
bun run check
bun run --filter @swarm/api test:access
bun run --filter @swarm/api test:hosting
bun run --filter @swarm/api test:unit
bun run test:repository
```

The real local RPC/SQLite/D1/R2 integration checks cover invitations, membership and agent revocation; repository/environment isolation; binding registration; direct Cloudflare rotation; bounded/revocable grants; issuer demotion; restart persistence; retention after disconnect; rejected value writes; and no public vault API. They also inspect the actual alarm schedule before grants, during a grant and after its read budget is exhausted. Nanohub application persistence is inspected for synthetic values. Miniflare's separate Secrets Store persistence is excluded because it simulates the platform that owns those values. Scope and deployment-manifest tests verify isolation without resolving values. All package checks use pinned **tsrs**. These local checks alone do not establish hosted deployment or live staging acceptance.

The private vault service, its Nanohub binding and a canary-only provider binding are deployed. Real hosted RPC/API reads, scope isolation, revocation, expiry, provider rotation and retention after disconnect passed with a synthetic value. The final canary scope has no connected references, grants or scheduled alarm; the synthetic value remains in Cloudflare. This does not activate secrets for other repositories or transfer any real credentials.
