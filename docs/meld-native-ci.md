# Native isolated Meld CI

Meld's legacy controller runs candidate commands in its result writer's guest
environment. The bridge therefore only accepts `head == base`; see the
[execution-boundary evidence](evidence/meld-bridge-lifecycle-validation.md#execution-trust-boundary).
The migration still needs feature-branch CI and staging before cutover.

`tools/meld-native-plan.mjs` prepares the next integration without modifying the
source repository or invoking its CI entrypoint. Given an operator-reviewed
immutable commit, it extracts only committed workspace manifests, the lockfile
and declared dependency patches into a new private image context. Git history,
application source, local environment files and Git credentials are excluded.
Symlink inputs, credential-bearing dependency URLs, unexpected workspaces and
unreviewed pipeline/toolchain changes fail before producing a context. Existing
output is preserved rather than overwritten.

```sh
bun tools/meld-native-plan.mjs \
  /absolute/private/meld.git FULL_ACCEPTED_COMMIT_SHA \
  /absolute/private/new-plan
```

The parent of the new output must exist. `plan.json` records input blob IDs,
lengths/hashes, pipeline blob and workflow hash. `context/` is the entire image
build context; `meld.yml` is the proposed `.github/workflows/meld.yml`. The
generator verifies immutable inputs, not the operator's authority to select a
base. Dependency metadata and patches remain private; use approved private
image storage.

The toolchain pins Bun 1.4.2 and Node 24.14.1 images by verified registry digest,
warms the committed dependency cache and installs Chrome during trusted image
preparation. It removes npm/npx and the preparation workspace. The generated
workflow verifies the versions, non-root identity, read-only source/script and
absence of control credentials/Docker socket, then runs frozen offline install,
pipeline regression tests, pinned-tsrs checks, the full unit/package suite,
Chrome availability, browser tests and the production bundle. Build-only inert
configuration preserves the existing pipeline's test/build mode distinction.
It does not run the candidate's result-writing CI script or any deploy command.

Bootstrap this workflow as the accepted default in a separate isolated Nanohub
copy. Preserve the original application commit and record the added workflow
commit separately. A feature candidate must then use that accepted workflow,
even if it replaces its own workflow with a passing placeholder. Use the native
`backend: "codegraff"`, a verified private image digest and `network: "none"`.
Each job receives a fresh VM and container; the trusted dispatcher observes the
container exit and retains the result outside candidate execution. Keep
Cloudflare control, registry issuance, Nanohub runner and deployment authority
in the trusted controller.

Current acceptance is preparation only: the actual frozen Meld main
`a5a6e2b3da5d7917a4d197bbb72dc3807d5d7fed` produces six allowlisted inputs and
the generated workflow compiles through Nanohub's real parser. Five Node/Bun
cases cover workflow semantics, input isolation, drift/path/credential refusal
and preservation of existing output. The first generated workflow used YAML
aliases, which the bounded runner correctly rejected; generation now disables
aliases and validates the compiled workflow before writing output.

A real image build and private publication are now independently
[reconciled after interruption](evidence/meld-native-image-reconciliation.json).
Its retained manifest/config digests match and the builder VM is observed
destroyed; the exact destruction time is not established. The original
interrupted controller is not relabeled as a completed harness pass.

A fresh 2026-11-09 source read observes Meld main at
`8554f69acf4a0936ccacb3b4b9b3e0f8147796d8`. Its lockfile, dependency declarations
and dependency patch match the built image's inputs. The web manifest only adds
live-test commands; the pipeline revision prepares signed Debian HTTPS/IPv4
downloads before Chrome installation. Required commands and test/build modes
are unchanged. That exact reviewed pipeline blob is now accepted and recorded
by the generator, which still refuses unknown revisions. Native acceptance
targets this freshly frozen application source, with separate synthetic
bootstrap/candidate commits, rather than describing the earlier source as
current.

Separate fresh-VM offline full-suite, exact-head native callback, malicious
workflow replacement rejection and job cleanup still need live acceptance.
No hosted runner, shared staging
or production activation is established by this preparation. Real-service
staging acceptance and the original application policy/merge/cutover gates stay
required.

## Opt-in native acceptance

`packages/api/scripts/smoke-meld-native-live.ts` is the real-cloud acceptance
harness. From clean committed trusted tools, provide a private bare source, the
verified private toolchain configuration, an existing sandbox-scoped account's
environment file and a new private artifact directory outside both repositories:

```sh
NANOHUB_LIVE_MELD_NATIVE=1 bun packages/api/scripts/smoke-meld-native-live.ts \
  /absolute/private/meld.git /absolute/private/native-image-config.json \
  /absolute/private/codegraff-staging.env /absolute/private/new-acceptance
```

It imports an isolated copy using the exact built CLI. Its accepted bootstrap
commit adds only the generated workflow to the frozen application source; a
separate synthetic candidate changes only that workflow and a harmless probe
file. These fixture commits are distinct from the original application SHA and
are never pushed to Meld's GitHub repository. The seed queue item is completed
with no successful check, rather than fabricated CI evidence.

The harness requires the real suite on the candidate through the accepted
workflow, checks that normal/forced/deletion writes to protected main fail,
and keeps pre-PR staging mandatory after CI passes. It verifies private log
delivery, anonymous denial, retry invalidation and stale callback rejection,
runner/import/Git credential revocation, independent VM destruction, fixture
closure and unchanged original refs. Its final acceptance flag depends on
these postconditions, not only the container's exit code. The provider key stays
in the trusted process. Without explicit opt-in it exits before dispatch.

An uncertain live operation must be observed through its retained run, capacity
and sandbox receipts; do not replay the launch. Native logs retain a bounded
tail, so a successful suite does not provide individual test counts beyond the
retained output. Fixture checks and inert build settings do not establish real
staging auth, storage, persistence, search or AI acceptance.

The refreshed source's complete bundle measures 372,270,805 bytes (355 MiB).
The harness therefore selects a trusted 512 MiB source limit and four parallel
64 KiB uploads. The default runner limits stay 64 MiB and one upload; operators
can select bounded larger transfers without dropping history or binaries.
Concurrent source transfer has fixture coverage for out-of-order completion,
exact byte reconstruction, failure drain before destruction and pre-allocation
limit enforcement. Actual large-bundle native acceptance is still required.
