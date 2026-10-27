# Bun and Actions validation — 2026-10-26

Package management is pinned to Bun 1.4.4 in `package.json`. The imported text
lockfile is `bun.lock`; `package-lock.json` is removed. Active development docs,
workflow jobs and runner examples now use Bun. Historical evidence records retain
the commands used at that time. Pinned tsrs is unchanged.

The sandbox Dockerfile copies a digest-pinned official Bun binary into the
existing digest-pinned Node 24 image, removes npm/npx, and prewarms the Bun cache.
Node remains the runtime for existing node:test, SQLite and Miniflare harnesses.
The image still requires a real build/publish and its resulting digest in the
private dispatcher configuration.

Local results:

| Validation | Result |
| --- | --- |
| Clean frozen install in a temporary empty workspace, followed by deletion of dependencies and a frozen offline reinstall | Both pass, 542 packages installed per run |
| `bun run check` | API, web and vault pass pinned tsrs |
| `bun run --filter @swarm/api test:unit` | 74 tests pass |
| `bun run test:repository` | 33 unit cases and native Git/HTTP/DO integration pass |
| `bun run --filter @swarm/api test:access` | 3 unit cases and real vault/ACL integration pass |
| `bun run --filter @swarm/api test:hosting` | 16 cases and namespace/HTTP integration pass |
| `bun run --filter @swarm/web build` | Production build passes |
| `git diff --check` | Pass |

The Git integration emits a workerd RPC-result disposal warning, while passing
all assertions and exiting successfully. This warning is not considered resolved.

The supplied Codegraff credential is stored only in a private host configuration
file outside this repository with mode 0600. A repository-file scan confirmed its
value is absent. It is never bundled into candidate code or logged. A live gateway
request returned HTTP 403 `insufficient_scope`: the key needs the `sandbox` scope.
No VM was allocated, and no live cloud test is claimed. The client now sends an
explicit User-Agent and reports this known scope diagnosis without echoing raw
gateway response bodies.
