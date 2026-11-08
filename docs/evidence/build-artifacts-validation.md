# Private build artifact handoff — 2026-11-09 (SGT)

The [real cloud component probe](build-artifacts-live-receipt.json) passes on
Nanohub `e206a92cdf949bf27e87462ef43143cce90d6c5f`. It uses two fresh Codegraff
VMs, the pinned private toolchain and a tiny committed synthetic repository.
It does not use the original Meld application or a hosted Nanohub CI callback.

The valid job creates a Worker fixture, binary data, duplicate content and an
empty file. The wrapper preserves only the selected directory on a separate VM
mount before exit. After the container stops, the controller captures four files
totaling 400,072 bytes, then destroys the VM. The loader verifies all bytes and
the exact run/head/base/attempt/job/image/VM binding after destruction. This
proves the output survives the job's tmpfs lifecycle without keeping the VM.

The second job creates an intentionally unsafe symlink. Its build commands and
snapshot copy finish, but the trusted reader refuses the output with the
dedicated rejection code. The private receipt is Failed, the check reports
Failure and no completed artifact can be consumed. The negative result is an
expected rejection, not a passing application test. Independent provider reads
confirm both VMs destroyed; neither cleanup receipt needs repair.

The [handoff contract](../build-artifacts.md) bounds bytes/files/paths/archive
metadata and never extracts candidate paths on the controller. It stores only
content-addressed blobs and metadata in private attempt storage. Deployment
credentials are not introduced into candidate execution. An exporter starts
once; only subsequent read observations retry. Partial host files are removed
after outstanding reads settle, and the failed receipt prevents replay.

Local validation passes:

- 499 API unit tests.
- 77 hosting cases plus real Worker shared-capacity and namespace/Git fixtures.
- 61 focused cases on Bun, including the actual Python reader, bounded gateway
  responses, binary/empty/duplicate bytes, real socket and root-symlink refusal,
  hostile archive paths/types, bounds, corruption, revocation, ambiguous launch
  acknowledgements, stale contexts, host symlinks and cleanup gating.
- Pinned tsrs for API/web/vault, plus fresh operator binding/syntax preflight.
  This is not complete operator JavaScript typing.
- Gitleaks 8.30.1 finds no credential-pattern matches in the implementation
  commit with inline allowances ignored.

The earlier [full native Meld pass](meld-native-ci-live-validation.md) retains
its own source and scope. This probe closes the new optional artifact component,
not the remaining application staging gate. A complete prebundled Meld Worker,
trusted target configuration, credential-isolated Cloudflare uploader, fresh
deployment authority, real-service acceptance, shared hosted artifact storage
and retention still need their own implementation and acceptance.
