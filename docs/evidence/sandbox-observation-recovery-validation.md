# Bounded runner observation recovery — 2026-11-09

The [real native Meld attempt](meld-native-cloud-observation-failure.json)
at trusted Nanohub source `f2bfdafd2beb5d671dfe2d0838702b089755682b`
remains **failed**. Its authenticated completion reports `meld/check:failure`;
the saved final log contains a fetch `ECONNRESET` socket error. That log does
not identify which observation failed or prove an application test failure.

The real provider VM received the full 376,364,094-byte credential-free bundle,
verified its hash and checked out the exact candidate. The independent live
snapshot reached Browser checks after offline installation, policy checks,
pinned tsrs and unit/package groups: 4,231 tests passed and 205 skipped.
Browser completion and the production build are **not established**. The final
callback did not turn that partial snapshot into a passing check. Independent
cleanup confirmed the VM destroyed, runner revoked and denied, fixture closed
and original source refs unchanged. No staging or production deployment occurred.

The dispatcher now retries only explicitly selected observations of the same
existing job: startup state, candidate authorization, container status and final
logs. Recovery permits at most eight reads and a 60-second recovery window,
bounded by the original job/CI deadline. Individual network requests are capped
at 20 seconds or the remaining window. Transient network failures and HTTP
408/429/500/502/503/504 may recover; auth/absence errors, malformed status and
failed control commands do not. Status/log recovery checks current authorization
before another read, and final completion checks authorization again. Unavailable
observations cannot produce Success. Lease responses are discarded rather than
left with unconsumed bodies. This is not evidence that unconsumed bodies caused
the observed reset.

Allocation, container launch, source assembly, toolchain mutation and callback
delivery are not placed inside this observation retry helper. Existing explicit
capacity-denial handling and verified immutable upload recovery remain separate.
No new job or replacement VM is launched to recover a lost read.

Validation on the corrected source:

- 59 focused backend/runner/observation tests pass on Node and Bun. Faults cover
  lost status/log/lease reads, a single allocation/launch through recovery,
  authorization loss, malformed status, permanent outages, late responses and
  single-shot launch failure. Lease checks discard bodies on success and denial.
- 492 API unit tests pass.
- 70 hosting tests and actual Worker capacity plus namespace/Git integrations
  pass, including private logs, retry invalidation, revocation and restart state.
- Pinned tsrs passes API/web/vault: two fresh tasks, one cached. Operator binding
  preflight includes the new module; it does not claim full JavaScript typing.

A [fresh native cloud acceptance](meld-native-ci-live-validation.md) now passes
on the corrected source, including the full offline suite, authenticated native
callback, stale retry rejection, revocation and independent VM destruction.
It does not establish that a transport fault occurred during that run. The
earlier failure remains failed, and the hosted fleet is not activated.
