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
