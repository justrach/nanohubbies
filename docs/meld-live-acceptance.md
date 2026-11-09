# Isolated Meld real-service acceptance

`tools/meld-live-acceptance.mjs` exports `createMeldLiveAcceptance`. This is a
trusted controller component for the native staging adapter. It is implemented
and locally tested; no real-service run or hosted activation is claimed.
The [validation receipt](evidence/meld-live-acceptance-validation.json) records
544 passing API unit cases, API typechecks and the 23-file pinned-tsrs operator
binding check. A functional wrapper test executes its command/report logic with
synthetic services. The actual reviewed staging suite also prepares and verifies
as a 1,976-file, 10,226,417-byte Git bundle; that suite has not been executed live.

The operator prepares an independently reviewed full Git commit with
`prepareMeldLiveSuite({source, commit, output})` from `tools/meld-live-suite.mjs`.
The source and new private output directory must be outside candidate execution.
Only committed regular files enter a parentless runtime bundle. Human review
media under `review/` and `review-evidence/` are excluded. Active environment
files, symlinks, submodules and oversized inputs are refused. Binary bytes and
executable modes are preserved. This runtime snapshot is not a Git migration.
The original prepared object and verified bundle/manifest hashes are required;
a copied summary does not establish trust.

Configure the factory outside the candidate checkout with that suite, a trusted
Codegraff client, a digest-pinned private Cloudflare image and its pull-credential
issuer, a function resolving only the staging test credential, and the inspected
`MELD_STAGING_TEST_AUTH_SHA256` value as `testTokenSha256`. Keep these values in
private operator configuration. There is no automatic credential discovery or
fallback to an administrator credential. Export the returned `preflight` and
`accept` functions from the configured external acceptance module.

The native staging adapter invokes preflight before upload. Missing or mismatched
test credentials therefore block provider writes. The adapter supplies its own
exact deployment/version verifier to acceptance and checks it again afterward;
an unchanged public seven-character build ID alone is insufficient.

Acceptance records an exclusive, synced intent for the run/attempt before VM
allocation. A restart or uncertain failure cannot automatically repeat real
service mutations. Inspect the private intent and reconcile before making an
explicitly new attempt.

Each acceptance job uses a separate disposable VM and non-root container with
the reviewed suite, not candidate application code. Frozen offline installation
finishes before the controller delivers the staging test token through a
read-only input mount. The controller checks current server authorization,
exact provider deployment and public version before delivery and after testing.
The token never enters Git objects, shell arguments, Docker environment flags or
published logs. Normal candidate workflow dispatch cannot enable this channel.
The reviewed test child receives the scoped test token in its own environment;
this does not protect it from the reviewed suite or its dependencies. Do not
reuse this mechanism for production or control-plane credentials.

The original reviewed `liveEnvironment`/`liveResult` helpers and exact
`bun run --cwd apps/web e2e:live:social` command run the desktop Pinterest, X and
Telegram suite. This performs real staging writes and external service calls;
it includes the existing Telegram sweep endpoint, which can resume queued work.
Activation needs the existing pipeline's authorization and coordination for
those effects. This component does not grant shared-database migration authority
or lock out another staging controller.

Success requires all three platforms, passing test exit/status, bounded numeric
timings, exact source/deployment identity and confirmed sandbox destruction.
Only a closed structured report becomes the private hosted `meld-live.log`.
URLs, response text, browser sessions, screenshots, traces and raw guest output
are excluded. Failure leaves the private controller intent and receipts for
inspection and returns no passing real-service evidence.

Local verification uses mocked provider/service boundaries and real Git objects:

```sh
node --experimental-transform-types --test \
  packages/api/scripts/meld-live-suite.test.mjs \
  packages/api/scripts/meld-live-acceptance.test.mjs \
  packages/api/scripts/meld-native-staging-adapter.test.mjs \
  packages/api/scripts/codegraff-actions.test.mjs
bun run check:operators
bun run --filter @swarm/api check
```

The actual prepared suite is pinned separately from the application candidate.
Changing that pin or the social command requires operator review. Live execution
still requires the missing staging test credential reference, schema compatibility
and coordinated staging deployment; a local test pass does not satisfy them.
