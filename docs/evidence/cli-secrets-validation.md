# CLI secret administration — local candidate 0.4.18

This is local source/bundled CLI and real Worker/DO/D1/Secrets Store emulator
acceptance. **No production API/Vault deployment or cloud release acceptance is
claimed.** Public CLI 0.4.17 was independently read on 2026-10-30 at 21:28 UTC:
85,565 bytes, SHA-256
`44d029819890d81384324fa159cb4c471cfb3c36e8b61e6c313eb7d96738d579`.

Candidate 0.4.18 builds to 95,151 bytes, SHA-256
`893019ceef9abaa623a527b99e436ce7d4fee868d029195f0fa7556e8748b10c`.
The existing 0.4.17 file retains its original hash. Candidate artifacts do not
establish hosted publication.

Passed checks:

- **407 API unit tests**, including twelve Vault administration cases and four
  secret scope/consent cases.
- **76 CLI tests**, including private-file checks, 100 long selected names,
  symlinks/modes/host/environment/parent mismatch, lost responses and redaction.
- The access gate's **24 unit cases** and actual Worker integration scripts:
  Vault callback transit, source/bundled secret CLI, existing collaborator/Vault
  lifecycle and source/bundled collaborator CLI.
- `bun run check`: three workspace checks with pinned tsrs and the existing
  operator binding/syntax checks.
- `git diff --check`.
- The complete repository gate: **300 unit cases** followed by the real
  Worker/Git/CLI/review/protection/archive/recovery integration chain.
- The exact downloadable 0.4.18 module's secret integration, with its version,
  byte count and SHA-256 checked before execution.
- Hosting/pool and both hosted-fixture regression commands, the four shell gate
  runner cases, the full OpenNext build and main/Vault Wrangler dry runs.

The real local RPC tests cross API Worker → private Vault Worker → per-scope
Durable Object and back through a one-call authority capability. They exercise
stale/legacy reference edits, provider scope, unknown/value fields, fixed expiry,
post-revocation recovery denial after restart, retained provider values and a
null cleanup alarm after the final grant is revoked.

Source and bundled CLI integration tests exercise explicit admin capabilities,
writer/reader denial, API/Git credential separation, saved-file-before-POST,
lost-ack recovery without duplication/extension, original parent identity,
parent credential revocation, final demotion and credential revocation after
the HTTP gateway, demotion during provider redemption, old-RPC rejection,
archive-safe revocation, owner/repo aliases and current external team ownership.
The public plaintext-value response is explicitly private/no-store.

The test-only session/provider and fault hooks are not production entrypoints.
Provider values are synthetic and local; no existing Meld or Cloudflare-held
customer secret was read, copied, rotated or replaced. No candidate receives a
Vault grant automatically.

The first whole API unit run exposed two Node-only Cloudflare module mocks
missing the new `RpcTarget` export. Those mocks were updated; the complete rerun
passes. The original failing log is retained separately from the passing run.

Remaining release work: frozen Linux project gates at the exact source, normal
and recovery-held disposable app validation, compatible Vault-first rollout
with unchanged bindings/value custody, immutable public installer/assets and
scope/consent verification. Production grant mutations and actual runtime
eviction are not proved by these local tests. The broader staging/cutover,
production recovery/load and unattended runner gates remain open.

The first frozen Linux attempt at `730d3d03218c136580dc4b8bf36fd81a96c4c72f`
passes locked offline install and all 407 API unit cases, then stops in the
repository gate. Its existing deployment CLI test expects the secrets route to
be unsupported (404); the new explicitly scoped route denies that credential
with 403. The assertion now checks the exact insufficient-scope response and
challenge. The source deployment integration rerun passes. This attempt remains
failed, and a separate Codegraff GET confirms its VM is destroyed. A subsequent
full run must also exercise secret commands using the exact distribution module,
whose version, byte count and hash are checked before execution.

The complete local repository rerun also exposes the same stale route expectation
in environment and general CLI acceptance, plus a general CLI test using the now
valid `secrets:read` permission as an invalid scope. Those assertions now require
the precise scope denial and reject an unsupported `secrets:values` capability.
The first retry launch stops at its read-only Codegraff preflight because sandbox
access cannot be verified; it never reaches source freezing or VM allocation.
Neither attempt is counted as passing cloud acceptance.

The second retry reaches a fresh VM but stops before executing candidate code:
temporary private-registry pull credential issuance fails. A separate provider
GET confirms destruction. Read-only Wrangler checks then report an expired login
that cannot refresh. Routine renewal requests the unchanged permission set but
reaches an unauthenticated Cloudflare sign-in page; no new login is completed.
The [attempt receipt](cli-secrets-cloud-attempts.json) retains all three outcomes.
Cloud release acceptance, disposable delivery and Vault-first rollout remain
pending; no production deployment is requested.

The full local recovery gate additionally catches a changing `serverTime` field
in ordinary Vault metadata. The clock now appears only in the authenticated CLI
grant response after final authorization. Persistent metadata is compared exactly
across cold restoration; no comparison fields are discarded. New integration
assertions verify the CLI clock bounds and its absence from ordinary metadata.
The corrected cold recovery and complete repository gate pass, alongside fresh
407-case API, access and tsrs reruns. The immutable CLI module remains unchanged.

Implementation and acceptance corrections are published on
`codex/standalone-git-host`. Main traffic is independently observed on
`a37ab061-a029-4480-9fb9-2b7cefeb19e3`, serving public CLI 0.4.17. Source
publication is not a passing hosted workflow or release deployment.
