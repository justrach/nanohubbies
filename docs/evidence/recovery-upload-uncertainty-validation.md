# Recovery upload uncertainty — 2026-10-30 JST

**The full hosted changing-Git rollback-and-return gate remains unpassed.**
The [sanitized receipt](recovery-upload-uncertainty-receipt.json) separates the
failed cloud attempt from its local diagnostic correction and independent cleanup.

## Hosted attempt

Run `mvu2nz3j-9d99a5af39` uses source `7df9b86`, a fresh private Cloudflare
application/gate/Vault, an owned bucket/database and one synthetic entry in the
existing account Secrets Store. It does not create/delete the account store or
restore production resources.

Startup identity/expiry and the initial held-phase observation pass. The first
checkpoint retains 15 DO instances across ten classes, 17 R2 objects/18,843 bytes
and a ten-object Git graph. Ordinary traffic remains held. The fixture accepts
a subsequent Git commit, denies revoked synthetic credentials and verifies provider
rotation without a Vault redeploy. Provider values are absent from the retained
application backup. The trace retains 373 events with zero write failures.

The next phase command, `043-deploy`, fails at the owned Worker's `/versions`
endpoint with Cloudflare code `100312`, “Completion token has already been
consumed.” The controller does not replay the command. There is no complete second
checkpoint and no loss/restore phase. The original failure path does not retain
an active-version/phase observation before cleanup retires the application; the
provider message alone does not establish whether a version upload had effects.
This attempt does not validate corruption rejection, older recovery or newer return.

Cleanup completes automatically. Independent reads at `2026-10-29T22:07:28.371Z`
verify API/gate/Vault Workers, bucket, database and synthetic provider entry absent;
required application/Vault namespace-retirement receipts are verified. Private
keys/grants are removed and original provider-entry IDs/names remain present.
Existing provider values are not resolved for this comparison.

Fresh before/after provider and public-version reads agree: production main remains
`857257c1-18fa-4866-87f8-2e9a9216bf20` at 100%, and Vault remains
`02dcb88b-5c99-49d9-a4b6-cb95451e6bb5`. No production deployment, Git ref or request
hold is changed. The cloud process and independent observers are terminal.

## Diagnostic correction

Source `16b5d65` recognizes only that exact error for the explicitly owned recovery
app/version endpoint, excluding uncertain process termination, contradictory
acknowledgements, authentication/transport errors and unrelated targets. It attempts
one read-only active-version observation and persists a resource fingerprint with
the held phase, or an explicit unavailable/invalid observation. Raw bindings and
arbitrary upstream error messages are excluded.

The controller still stops. A matching desired phase is not treated as a command
acknowledgement or recovery acceptance; no further deploy is attempted. Failed
observation or proof persistence cannot cause another mutation. The existing narrow
pre-code-upload retry remains separate and cannot turn this error into a third
command.

An offline replay uses the captured failing CLI output and retained immutable
provider metadata. It verifies one command callback, one observation callback and
an uncertainty receipt, followed by rejection. It makes **zero cloud requests**;
the supplied retained metadata is not a fresh observation of the failed upload.
This replay does not retroactively resolve the cloud outcome.

## Validation and limits

- `bun run test:hosted-recovery`: **91 pass under Bun**; **23 pass under Node
  24.14.1**, including phase-upload diagnostics and real HTTP protocol cases.
  Counts overlap.
- `bun run test:hosted-fixture`: **32 Bun and ten Node proxy/provider cases** pass,
  with pinned tsrs. These overlap the recovery fixture cases.
- Root `bun run check` passes all seven operator targets and three workspace
  tasks; all three workspace results are cached. Recovery/fixture tsrs commands
  above run directly.
- The unchanged API's **365 unit cases** pass earlier in this turn at `7df9b86`,
  before the diagnostic-only follow-up. No API runtime source changes afterward.
- `git diff --check` passes. The new phase tests also run under the controller's
  Node runtime through the existing native fixture CI job and ninth Linux gate.
  There is no fresh nine-gate cloud Linux acceptance.

The final diagnostic correction has local acceptance. It has not run against a
new hosted phase failure. Full changing-Git restore/return acceptance, production
inventory/draining, independent latest-authority acquisition, namespace-loss
recovery, retained long-term backups and measured RPO/RTO remain open. Intended
application CI/staging, hosted Actions activation and traffic/security/operations
acceptance remain separate requirements. Source is locally committed, not pushed;
the published CLI remains 0.4.16.
