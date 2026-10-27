# Isolated hosted Git import acceptance

`tools/verify-hosted-git-import.mjs` runs the packaged `nh` CLI against the full
web/API bundle on disposable Cloudflare Workers, Durable Objects, D1 and R2.
It uses the configured account identity to create randomly named resources;
production bindings, secrets and Git remotes are never copied into the fixture.

Run the harness checks first:

```sh
bun run test:hosted-fixture
```

The live command is explicitly opt-in. Supply absolute paths to an account
configuration, a complete local Git repository, and a private artifact directory
outside source checkouts. Build the web app and packaged CLI before running it.

```sh
NANOHUB_LIVE_CLOUDFLARE=1 node tools/verify-hosted-git-import.mjs \
  /absolute/path/to/account-config.jsonc \
  /absolute/path/to/repository.git \
  /absolute/private/artifacts
```

Both Workers require separate random keys. The public control gate expires; the
backend also rejects requests independently. A fixture-only bootstrap creates one
fixed synthetic owner using the real session signer. This does not test production
OIDC. A loopback proxy accepts only the repository's Git paths and ordinary Git
credential, then adds the private control key upstream. The CLI does not receive
Cloudflare credentials or fixture control keys.

Before uploading source, the harness checks the active version's resource bindings
and retains the normal 50,000-subrequest budget. It verifies complete import,
independent clone/fsck, verification-only resume, unchanged refs and source,
absence of agent registration, and denial after revoking the Git credential.

Private receipts are written before provider mutations. Cleanup fences application
requests, deploys an explicit deletion migration for all fixture Durable Object
classes, confirms namespace retirement, deletes the backend, purges the dedicated
bucket, and independently confirms deletion of both Workers, R2 and D1. A cleanup
failure retains the control gate, keys and receipts needed to resume. A successful
test with incomplete cleanup still exits with an error.

To resume cleanup after an interruption, pass the run's receipt directory:

```sh
NANOHUB_LIVE_CLOUDFLARE=1 node tools/verify-hosted-git-import.mjs \
  --cleanup /absolute/private/artifacts/RUN_ID
```

Recovery regenerates resource names and configuration from the validated fixture
identity. It observes provider state, including create operations whose response
may have been lost, and refuses to treat failed observation as absence. Resource
deletion uses only generated names; saved arbitrary resource targets are rejected.
Do not remove private receipts or keys until cleanup is confirmed.

Passing this check establishes the tested graph and hosted import path. Application
CI/staging, sustained traffic, real authentication, and hosted disaster recovery
remain separate release gates.
