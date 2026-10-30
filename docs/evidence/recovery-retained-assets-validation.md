# Recovery phase asset retention — 2026-10-30

The recovery controller now retains existing Cloudflare assets when changing an
owned fixture's phase. Local regressions and an isolated provider protocol probe
pass. **Full hosted changing-Git restore/return acceptance remains unpassed.**
The [receipt](recovery-retained-assets-receipt.json) separates these scopes.

The [previous attempt](recovery-upload-uncertainty-validation.md) stopped when a
phase deployment's asset completion token was already consumed. It remains a
failed attempt. The new path avoids uploading unchanged assets for phase updates;
it does not retry or adopt that uncertain deployment.

## Implementation and safeguards

Cloudflare documents [`keep_assets` for retaining an existing asset collection](https://developers.cloudflare.com/workers/static-assets/direct-upload/#createdeploy-new-version).
Installed Wrangler 4.151.0 forwards this through its metadata configuration.
The initial fixture deployment still uploads the actual built assets normally.
Subsequent phase configurations omit the upload directory, retain the ASSETS
binding, set `keep_assets: true`, and explicitly preserve Worker-first routing.
No completion JWT is supplied.

This path accepts only the canonical configuration of an already deployed,
held, privately owned repository/Vault recovery fixture. Account, run, Worker,
entrypoint, storage/service declarations, variables, routing and existing
provider bindings are checked before deployment. Arbitrary metadata overrides
and altered configuration fail before mutation.

A successful command must still acknowledge the active version. Afterward,
the complete provider resource fingerprint must match the prior version after
normalizing only `HOSTED_REPO_PHASE`. Code, namespaces, bindings, limits,
compatibility settings and asset routing cannot silently change. Data-plane
phase/version confirmation remains required before recovery work proceeds.
Unknown upload outcomes still stop; the existing uncertainty diagnostics and
narrow pre-upload-refusal handling are unchanged.

## Local checks

`bun run test:hosted-recovery` passes 95 Bun cases and 27 Node protocol cases;
counts overlap. Tests cover owned/canonical configuration, variable and binding
mismatches, phase-only resource proofs, rejected code/namespace/service/budget/
routing drift and the prior uncertain-upload rules. An actual Wrangler dry-run
multipart is parsed to verify retained assets, omitted completion JWT, the
ASSETS binding, held target phase, code module and subrequest budget.

Root `bun run check` passes all eight operator binding targets and three workspace
tasks; the workspace tasks are cached. Operator checking is explicitly a
binding/syntax check, not full JavaScript type checking. The fixture Workers use
pinned tsrs. No fresh nine-gate Linux run is claimed for this controller change.

## Isolated Cloudflare protocol probe

A new disposable Worker has only synthetic control variables, ASSETS and
version-metadata bindings. It has no production data/service bindings or custom
domain. It uses a small probe entrypoint and the actual built asset collection,
not the complete recovery application or its storage resources.

The probe passes **seed → frozen → verify → reconcile → frozen → verify**.
All five transitions retain identical provider resources except the phase.
At each state, the manifest and CLI 0.4.17/0.4.16 modules match local bytes:
18 comparisons total. All 18 normal asset GETs remain private/no-store 503;
all six HEAD responses are held and bodyless. Phase/version readiness confirms
each new active version. The command output reports no asset upload for the
retained transitions; this is not an independent HTTP wire trace.

The Worker is deleted and a separate exact-name provider read confirms absence.
Production main remains `a37ab061-a029-4480-9fb9-2b7cefeb19e3` before and after.
No production hold, Git ref, permission or provider secret is changed.

This proves the provider asset-retention mechanism for these phase changes.
The full fixture must still demonstrate both checkpoints, storage loss,
corruption rejection, older-checkpoint authority reconciliation, newer Git and
Vault return, restart and cleanup. Original migration/staging, runner activation
and traffic/security/operations acceptance remain separate gates.
