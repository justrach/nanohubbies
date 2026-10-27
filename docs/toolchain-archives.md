# Trusted toolchain archive delivery

Codegraff Actions can prepare a fresh VM from a digest-pinned HTTPS Docker
archive, alongside the existing registry and snapshot paths. The trusted
dispatcher configuration selects the image; workflow or candidate code cannot
supply the download URL, digest or credentials.

```json
{
  "backend": "codegraff",
  "image": "sha256:REPLACE_WITH_EXACT_DOCKER_CONFIG_ID",
  "imageDownload": {
    "url": "https://private-delivery.example/toolchain.tar.gz?REPLACE_WITH_READ_CAPABILITY",
    "sha256": "REPLACE_WITH_ARCHIVE_SHA256",
    "bytes": 826656413
  }
}
```

This is a configuration fragment, not an enabled production configuration.
`bytes` must be the exact compressed/downloaded length; it is not an estimate.
The archive SHA-256 and Docker config ID are different pins. Docker `save`/`load`
can preserve the config ID without retaining the registry manifest digest.
The private Cloudflare registry example is the default configuration template.

## Preparation and authority

Only HTTPS URLs without embedded username/password or fragments are accepted.
The archive requires an exact SHA-256 and integer byte length from 1 through
2 GiB. Snapshot and archive-download modes cannot be mixed. The Docker backend
rejects this Codegraff-specific option before claiming a job.

Preparation starts once in the new VM and polls a unique completion marker.
Observing a timeout does not restart the download or Docker load. The trusted
control script is owner-readable only and is removed when the transfer exits.
The request requires HTTP 200 and does not follow redirects. A streaming pipe
bounds the file to the configured size plus one byte even when Content-Length
is absent. The actual length and archive SHA must match before the file is
promoted to `/workspace/nanohub-toolchain/image.tar`.

The controller then loads the archive, verifies the exact Docker config ID and
rechecks the candidate lease before uploading candidate Git objects. The job
uses `--pull=never`. Download/load failure, wrong image, a revoked lease or
cleanup failure cannot produce a successful check. VM destruction retains the
existing confirmed-deletion requirement.

A signed URL is a credential. Keep it in trusted private configuration outside
the candidate checkout. It enters only the trusted VM's preparation script;
candidate mounts, environment, job logs and provenance do not receive it.
Receipts retain the archive digest and length, not its URL. Gateway credentials
remain in the host controller and never enter the VM. This is separate from
the workload-secret vault; no vault binding or stored secret value changes.

The controller does not automatically renew an expiring archive URL. The
[private Cloudflare registry path](private-toolchain-registry.md) instead issues
a fresh pull credential for each job and uses retained digest-pinned images.
For this archive mode, a private artifact
store, per-job URL issuance/renewal and real full-toolchain acceptance are still
required before using this mode for unattended production Actions. The saved
URL must remain valid through preparation; expiry fails the check without a
mutable-image or registry fallback.

## Verification

Ordinary `test:unit`, `test:repository` and `test:hosting` include the controller
coverage. They verify strict configuration, shell construction, one launch,
unique completion markers, bounded writes, cancellation, secret-free provenance,
preparation-before-candidate ordering, `--pull=never`, source-at-accepted-base
workflow selection, configuration forwarding and cleanup on every failure.

For a real small-image probe, prepare an operator-owned HTTPS fixture supporting
`/image.tar.gz`, `/redirect` (302 with the same archive body) and `/overflow`
(stream more than the expected bytes). The external configuration has
`syntheticFixture: true`, `image` and `imageDownload` as above, with an image
archive no larger than 1 MiB. Then run:

```sh
NANOHUB_LIVE_CODEGRAFF=1 bun run --filter @swarm/api test:toolchain-download:live \
  /absolute/private/synthetic-fixture.json /absolute/private/acceptance
```

An existing sandbox-scoped `CODEGRAFF_API_KEY` is required in the controller
environment. The opt-in script never registers a hosted runner, uploads
candidate code or runs the full project. It creates one temporary VM, verifies
the prepared image and negative cases, then confirms destruction. The operator
must separately remove the HTTPS fixture. Configuration/artifacts must stay
outside the checkout. See the [real probe receipt](evidence/toolchain-download-validation.md).

For the actual project image, `tools/verify-codegraff-toolchain.mjs` accepts
the same trusted delivery configuration. Its acceptance still requires all
offline project gates in a fresh VM and confirmed cleanup. The small-image
probe does not satisfy that larger requirement.
