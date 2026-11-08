# Private build artifact handoff

Trusted Codegraff controller configuration may select one output directory for
each accepted job. Candidate workflow files cannot enable capture or raise its
limits. This is a private build-to-deployer handoff; marketplace artifact actions
and a browser download service are not added by this change.

For example, the synthetic cloud probe uses:

```json
{
  "buildArtifacts": [
    {
      "job": "artifact/valid",
      "directory": "/tmp/work/.stage-out",
      "maxBytes": 1048576,
      "maxFiles": 20
    }
  ]
}
```

The directory must be a canonical child of `/tmp/work`, and the job must exist
in the accepted workflows. Invalid settings stop before provider access or CI
claim. Defaults are 128 MiB and 10,000 files; operator ceilings are 1 GiB and
20,000 files, with a 4 MiB manifest limit and bounded paths/depth/archive overhead.
These are size ceilings, not a guarantee of transfer before the job deadline.

The working directory is on tmpfs, which [does not survive container stop](https://docs.docker.com/engine/storage/tmpfs/).
For a selected job, the controller creates a writable output mount on that
job's disposable VM. After the final step, the wrapper copies only the selected
directory there without dereferencing links. Missing/copy-failed outputs fail
the job. The container's terminal success must include that copy. The export
reader runs only after the container stops; candidate processes cannot continue
writing the snapshot. Ordinary jobs receive no output mount.

The trusted VM reader first rejects links, hardlinks and special entries,
including sockets that tar could otherwise omit. It bounds file counts, total
bytes, names and depth, then reads a bounded archive without extracting it.
Archive links, devices, sparse headers, traversal, duplicate paths and file/directory
conflicts are refused. The file/size inventory must match the stopped snapshot.
Only regular-file bytes and relative names enter the manifest.

The controller reads canonical base64 in 32 KiB chunks, checks byte counts and
SHA-256, and stores data under digest filenames in a fresh private directory.
Candidate filenames are metadata, never controller extraction paths. Duplicate
content shares a blob; empty and binary files retain their bytes. Four readers
may run concurrently; errors stop new work and issued reads settle before local
cleanup. Only observations retry. An ambiguous exporter launch is never replayed.

The private receipt records pending/failed/complete state, policy, manifest
digest and exact repository CI run/attempt, head, base, job, image and VM identity.
Failed exports remove their own partial host directory and retain the receipt.
An existing receipt blocks another export for that job/attempt. A new attempt
uses its own directory. Operator retention and crash reconciliation remain
necessary for private files; no public artifact URLs are published.

`loadBuildArtifact` requires the matching trusted successful check and confirmed
VM cleanup. It validates the manifest and blobs again, rejects stale contexts,
and exposes file reads through the manifest with another hash check. Staging
adapters receive `results`, `buildArtifacts` and `toolchainImage` alongside the
existing context:

```js
const policy = context.buildArtifacts.find(item => item.job === "artifact/valid");
const result = context.results.find(item => item.name === policy.job);
const artifact = await loadBuildArtifact({
  artifacts: context.artifacts,
  run: context.run,
  policy,
  image: context.toolchainImage,
  result,
});
const workerBytes = await artifact.read("worker.mjs");
```

This verifies provenance and integrity, not whether the candidate's code is safe
to deploy. The deployer must obtain fresh exact-candidate environment authority,
use a trusted target configuration and validate deployment/version/real-service
acceptance. It must not execute candidate hooks with deployment credentials.
The artifact directory must remain available when a deferred deployment resumes;
a different controller without that private storage fails closed. Shared hosted
artifact storage and retention are separate work.

## Opt-in cloud probe

From clean committed tools, use a verified private image configuration, an
existing sandbox-scoped provider environment file and a new private directory:

```sh
NANOHUB_LIVE_BUILD_ARTIFACTS=1 bun tools/verify-build-artifacts.mjs \
  /absolute/private/image.json /absolute/private/provider.env \
  /absolute/private/new-artifact-probe
```

The probe runs a tiny committed fixture in two fresh VMs. It requires valid
binary/empty/duplicate content to survive container stop, and an intentionally
unsafe output to fail with the reader's rejection code. Both VMs must be
independently confirmed destroyed. It creates no GitHub/Nanohub repository,
hosted callback or application deployment. A live operation is observed through
its saved receipts and VM IDs; an observation timeout is not permission to
replay its launch.

Local validation includes real Python archive reading through a bounded gateway
fixture, actual socket/root-link refusal, corruption, revocation, lost launch
acknowledgement, stale bindings, host-link refusal and native job cleanup.
The [real provider probe](evidence/build-artifacts-validation.md) now passes at
`e206a92`, including stopped-container persistence, verified file reads, expected
unsafe-output rejection and independent destruction of both VMs. Meld's existing
Worker wrapper imports source modules in addition to OpenNext output: a complete
prebundled staging package and trusted Cloudflare uploader are still required.
