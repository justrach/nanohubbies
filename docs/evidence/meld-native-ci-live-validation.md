# Native isolated Meld acceptance — 2026-11-09 (SGT)

The [fresh native receipt](meld-native-ci-live-receipt.json) passes at trusted
Nanohub source `f01806c20796a476e26c6eb523a81659a4243e93`. This uses a real
Codegraff VM with an isolated local Nanohub Worker/Git fixture. It does **not**
activate the hosted dispatcher or deploy the Meld application.

The frozen original Meld source is
`8554f69acf4a0936ccacb3b4b9b3e0f8147796d8`. The test adds the generated workflow
as bootstrap `8cc81833d840b4498d5d77f48d05fe1f330cc3a8`, then creates candidate
`483fcc9c9aeb40f91a5ad6c55f1c3935b2a0aa01` containing only an intentionally
replaced workflow and a harmless probe file. Those fixture commits are not
original Meld application commits and are never pushed to its GitHub refs.

The exact built CLI imports 18,107 objects and one ref, independently clones
and passes strict fsck. Its import credential is revoked and denied before CI.
Normal, forced and deletion pushes to protected main are rejected for policy
reasons; the same Git credential first successfully pushes the candidate branch,
then is revoked and denied. PR creation before CI is rejected.

The dispatcher loads the pinned private toolchain, removes pull authentication,
transfers the complete 376,502,159-byte Git bundle with four bounded upload
workers, verifies SHA-256 and checks out the exact candidate. Execution uses the
accepted bootstrap workflow despite the candidate's replacement. Offline
installation, policy tests, pinned tsrs, unit/package tests, Chrome, browser tests
and the OpenNext production bundle all complete successfully:

- Unit/package suites: **4,231 passed, 205 skipped**.
- Browser suite: **468 passed, 70 skipped**, reported duration 10.7 minutes.
- Final retained log ends with **OpenNext build complete.**

Skipped tests are not represented as verified behavior. Real-service staging
auth, storage, persistence, search and AI acceptance remain separate gates.

Runtime reads observe UID 1000, zero effective capabilities, no-new-privileges,
read-only source/script mounts, no Docker socket and no controller credentials
from the checked set. Kernel cgroup files confirm 8 GiB memory, a four-core CPU
quota and 512 processes. Docker's zero usage summary is not usable consumption
evidence; the daemon also reports no swap-limit support. The observation records
interfaces without claiming that interface names prove network isolation.

The authenticated native callback binds Success to the exact head/base and
attempt. Private logs are delivered to the owner and denied anonymously. A new
retry clears the earlier results and rejects the old callback. PR creation
after CI still fails specifically for missing staging acceptance. Final cleanup
revokes and denies the runner, closes the fixture and preserves original refs.
The provider independently reports the VM destroyed, including a subsequent
read after harness completion; no cleanup errors remain.

The [earlier socket-reset attempt](meld-native-cloud-observation-failure.json)
remains failed. This fresh pass validates the corrected source; it does not
prove that a transport fault occurred during this run. Fault recovery itself
has [separate injected coverage](sandbox-observation-recovery-validation.md).

Still required before cutover: safe feature-candidate staging deployment and
real-service acceptance, intended hosted runner activation and callbacks,
compliant/rejected ordinary-agent merge acceptance in the real application
copy, operational load/recovery gates and an explicitly accepted cutover.
