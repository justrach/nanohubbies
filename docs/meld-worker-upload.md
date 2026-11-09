# Trusted Meld Worker upload

`tools/meld-worker-upload.mjs` prepares and uploads a **new, undeployed**
Cloudflare Worker version from a verified [native staging package](meld-native-ci.md).
The upload operation does not promote traffic. A separate explicit promotion
operation moves only the verified version to staging after another baseline and
authority check. Neither operation changes routes or cron schedules, applies
migrations, opens a Meld PR, or alone satisfies real-service acceptance. The current bridge
must continue to refuse unaccepted feature candidates.

The transport is implemented and locally tested. It has **not** passed a live
Cloudflare upload against Meld. The current operator login was denied access to
the staging account during a read-only check. No upload or deployment was made.
The [first frozen Linux run](evidence/meld-worker-upload-linux-attempt-1.json)
failed in the existing tar fixture's oversized command argument. That fixture
now sends the same JSON/binary data over stdin; the failed run remains a failure
until a new frozen run independently passes.

## Trust and package handling

The target is fixed to Meld's existing `meld-api-staging` Worker and staging
account. Production target overrides are rejected. Call
`prepareMeldWorkerUpload(context, profile)` with the controller's native artifact
context and a separately reviewed operator profile. The default package loader
requires successful checks, confirmed VM cleanup, matching run/attempt/head/base,
the pinned image and package profile, content hashes and the committed Worker
wrapper. Candidate build hooks, Wrangler and artifact JavaScript never execute
on the credentialed controller.

Preparation returns an immutable summary. Module bytes, asset bytes and provider
upload state remain private to the transport. Passing a copied or fabricated
summary cannot authorize an upload. Module names and MIME types are checked;
binary modules and assets retain their exact bytes. The combined package is
bounded to 128 MiB, module bytes to 64 MiB and each asset to 25 MiB.

Preparation also requires the inspected full staging commit in
`profile.baseline.sourceCommit`. It reads real Git commit parents and requires
that commit to be an ancestor of the candidate. A divergent candidate must first
be integrated and independently checked; the uploader never synthesizes a merge
or treats a PR-head pass as an integration pass. Replacement objects are disabled
and graft files are refused. The immutable plan records this staging base, and
changing it after preparation cannot reuse the proof. No candidate code or hooks
run during this check.

Asset hashes match Wrangler's BLAKE3 hash of base64 content plus extension.
Pinned `ignore` interprets `.assetsignore`; control files are not served as public
assets. `_headers` and `_redirects` are UTF-8 text in `assets.config`, as in
Wrangler's Worker upload form. Unignored `_worker.js` and `_routes.json` require
an explicit Pages migration and fail preparation. Pinned `mime-types` supplies
asset content types; it does not claim every extension matches Wrangler's bundled
MIME database. Files sharing a content hash must also share bytes and MIME type.

## Operator profile and baseline

The profile supplies the fixed account/script, the Nanohub staging environment
ID, an inspected baseline deployment ID, its single 100% version ID, the full
source commit mapped to that deployed version, and the
SHA-256 from `meldSettingsFingerprint()` on the `/settings` response. The
fingerprint excludes version annotations because `/settings` follows the latest
upload and our new version changes its message. It retains all resource fields,
including bindings, tags, limits and observability; uploaded/deployed version IDs
are checked separately. Canonical JSON recursively sorts object keys and preserves
array order. Do not use candidate configuration or
invent a baseline to get past an inspection failure.

The full source mapping is an operator-reviewed input, not inferred from a short
`/api/version` prefix. Establish it from the existing deployment's source/run
records and verify the live version before preparing the profile. Subsequent
provider checks fence the exact version and deployment IDs. Ancestry does not
authorize deployment, update any staging ref, serialize with another controller,
or replace the existing required approval and acceptance gates.

The reviewed version metadata permits only bindings, compatibility date/flags,
limits, `cache_options` and `keep_bindings`. It must use the pinned Meld profile,
the existing staging Hyperdrive, staging self-reference and staging application
origins. It cannot contain migrations, routes, secret values or `inherit`
bindings. `keep_bindings` retains both `secret_text` and `secret_key` without
reading or copying their values. Non-versioned observability settings are not
submitted through the version upload endpoint.

Immediately before the asset session and again before uploading the version,
the transport reads settings, deployments and uploaded versions. The inspected
baseline must still be deployed at 100%, and it must also be the latest uploaded
version. Every non-secret binding and the supported runtime settings must match
the reviewed profile. Unrecognized provider shapes or mismatches stop the
operation. This intentionally refuses an existing unpublished version rather
than silently inheriting its resources.

After upload, the exact returned version is read back. Its non-secret bindings,
secret binding names/types, compatibility settings and limits must match before
the receipt becomes `uploaded`. Provider schema compatibility and actual Meld
bindings still require live validation; local fixtures do not prove them.

## Fresh deployment authority

`POST .../ci/deployments/revalidate` accepts only `requestId`, `authorizationId`
and `attempt` from a current repository CI credential. It checks the active CI
lease, current source/base/ref/generation, environment revision, wait timer,
rejections and current eligible approvers. Its private, uncached response is
`{authorization, checkedAt}`. The authorization ID, issuance time and original
expiry remain unchanged. Revalidation creates no deployment result and does not
extend a lease.

`runOnce` passes `authorizeDeployment()` to trusted pipeline/staging adapters.
This uses the new endpoint and rejects stale observations or changed receipts.
Supply it as the uploader's `authorize` callback. The uploader requires a fresh
check before **every** provider write, including asset buckets, and enough
remaining authorization lifetime for its bounded request. An unavailable or
older server fails closed; there is no fallback to a cached approval.

This is a check immediately before a provider request, not an atomic transaction
across Nanohub and Cloudflare. Revocation after that check cannot retroactively
cancel a request already accepted by Cloudflare. An eventual promotion adapter
must revalidate again and verify exact deployment/version plus real services.

## Upload and recovery

`uploadMeldStageVersion(context, summary, profile, {credential, authorize})`
uses only Cloudflare HTTPS API endpoints. The credential callback resolves the
current control credential in trusted memory. Asset bucket requests use the
provider's upload JWT instead. No provider token or upload JWT is written to the
receipt, candidate workspace or Actions logs. Redirects are rejected and response
size and request duration are bounded.

Before any provider write, an exclusive private intent file is created outside
the candidate checkout. Each mutation records pending intent, its authorization
ID and acknowledgement. Returned provider IDs are retained. Session hashes must
belong to the prepared manifest, cannot repeat across buckets, and must complete
before the Worker upload.

There are no automatic write retries. A dropped or rejected acknowledgement
retains an `unconfirmed` receipt; even a second call with the same summary refuses
to replay the operation. A known uploaded version that fails readback remains
recorded and undeployed. Inspect the receipt and provider state before deciding
on a separate recovery operation. Do not erase intent files to retry blindly.

The upload result explicitly has `deployed: false`. Calling
`promoteMeldStageVersion(upload)` is a separate, single-use operation. It requires
the original deployed baseline and the new uploaded version to remain current,
rechecks the uploaded resources and asks Nanohub for fresh authority before a
100% deployment POST. It records the returned deployment ID and independently
reads the current deployment and version before reporting success. There is no
force flag, automatic rollback or replay. A lost traffic acknowledgement stays
`promotion-unverified`; inspect the provider before any recovery action.

`tools/meld-native-staging-adapter.mjs` connects these operations to `stagingGate`.
Its factory requires a fixed target profile, credential callback and absolute
trusted acceptance module path. The module must resolve outside the candidate
checkout and export `accept(context)` before any upload begins. It requires the
same run, head, base, attempt and authorization for acceptance. The gate verifies
Meld's seven-character build ID before acceptance and again afterward. Provider
observations, fixtures, a health response or build ID alone are insufficient.

An operator module outside the candidate may construct the adapter and export
its `dispatch`, `wait`, `accept` and `versionPrefixLength` fields for `runOnce`.
The operator must supply the actual real-service acceptance implementation,
profile and credential resolver; none are read from candidate configuration.
This implementation is not activated or live-validated. The server revalidation
endpoint is [deployed on Nanohub](evidence/deployment-authority-release-validation.md);
a valid hosted authorization flow still requires verification before enabling
the adapter.

Deployment serialization with Meld's existing pipeline, live provider contract
validation, real-service acceptance and protected merge/cutover acceptance remain
required work. The baseline checks are not an atomic cross-provider lock.

## Verification

```sh
bun run --filter @swarm/api test:unit
bun run --filter @swarm/api check
bun run check:operators
node packages/api/scripts/smoke-deployment-approvals.ts
```

The focused upload tests cover binary multipart round trips, duplicate assets,
cached assets, ignore rules and controls, secret retention, fresh authorization,
resource drift, unknown/repeated bucket requests, lost acknowledgements,
post-upload binding/runtime drift and rejection of production targets. An actual
credential-free Wrangler dry-run checks multipart module roles, secret retention
and the `cache_options` wire field. Wrangler omits asset metadata without an
upload JWT on that dry-run; it does not prove live asset acceptance.

[Frozen Nanohub validation](evidence/meld-worker-upload-frozen-validation.json)
on `ff8383f` passes all nine Linux gates, including 521 API cases, 103 CLI cases,
27 fixture cases and three uncached pinned-tsrs tasks. An independent provider
read confirms the validation VM was destroyed. The frozen Mac build and normal
Worker dry-run also pass, with all 21 published CLI releases retained and saved
source/build hashes rechecked. These checks prepare the Nanohub endpoint release;
they do not establish live Meld upload, promotion or acceptance.

Provider references:
[direct asset uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/),
[multipart metadata](https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/),
[Worker version uploads](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/create/).
