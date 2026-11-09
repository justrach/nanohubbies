# Controller input cloud boundary — 2026-11-09

Two fresh Codegraff VMs verify the controller-only input channel introduced on
`f36bfa80dbd05ac1d190261d87217de1cd27f0b3`. Both use the same digest-pinned
private toolchain and network-disabled, non-root containers. This is a synthetic
component probe using the existing Meld sandbox account, not hosted Nanohub
Actions activation or application-service acceptance. The [receipt](controller-input-cloud-receipt.json)
separates real cloud observations from local mocked integration checks.

The trusted-input job first proves its input file is absent and announces
readiness. The controller then uploads an inert fixture through the host input
directory. The guest verifies exact input bytes, UID 1000 and mode `0400`;
attempts to overwrite it or create another file through the mount fail. The
fixture value appears in neither Git source, shell arguments nor logs.

The ordinary job runs in a different VM with no controller input mount. Both
jobs verify absent controller environment credentials, no Docker socket, and
read-only source/job-script mounts. Each job passes, and separate provider
reads independently confirm both VMs were destroyed. No persistent credential,
Nanohub repository, Meld application data or deployment was created or changed.

Local tests additionally compose the real native adapter and acceptance factory
through `stagingGate`, with mocked provider and service boundaries. They verify
preflight runs before provider writes; acceptance uses the adapter's acknowledged
deployment/version verifier; and metadata-only deployment movement fails before
input delivery, after tests, or after local evidence publication. The public
build ID stays unchanged in those negative cases. A previously published local
report cannot make a moved deployment pass the outer staging gate.

Version endpoint reads now reject redirects, cap streamed response bodies at
8,192 bytes, validate configuration before network access and exclude endpoint
values or transport/parser exception text from controller errors. Tests cover
exact prefixes, supported field aliases, malformed JSON, injected text, stream
failure, exact-size and oversized responses, and cancellation.
The bounded reader also successfully matches the existing staging build prefix
in an anonymous read-only check. That is endpoint compatibility, not fresh
provider identity, deployment authorization or application acceptance.

All 550 API unit tests, the API pinned-tsrs check and the 23-file operator binding
check pass. This establishes the component boundary and local composition only.
Actual live-suite execution still requires its scoped staging credential,
schema compatibility and coordinated deployment. Shared-host multi-tenant
isolation, sustained production load and unattended account activation are not
established by this probe.
