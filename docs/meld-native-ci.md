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
the generated workflow compiles through Nanohub's real parser. Four Node/Bun
cases cover workflow semantics, input isolation, drift/path/credential refusal
and preservation of existing output. The first generated workflow used YAML
aliases, which the bounded runner correctly rejected; generation now disables
aliases and validates the compiled workflow before writing output.

A successful image build, private publication, separate fresh-VM offline full
suite, exact-head native callback, malicious workflow replacement rejection and
independent cleanup still need live acceptance. No hosted runner, shared staging
or production activation is established by this preparation. Real-service
staging acceptance and the original application policy/merge/cutover gates stay
required.
