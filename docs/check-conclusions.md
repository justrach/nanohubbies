# Required check conclusions

Nanohub's native CI result `state` is a terminal conclusion, separate from the
run's lifecycle state (`queued`, `running`, `waiting`, `complete`, `superseded`).
Trusted runner completions retain the original conclusion without converting a
skipped or neutral job into a successful execution.

| Check conclusion | Ordinary required check | Success-only required check | Display |
| --- | --- | --- | --- |
| `success` | Satisfied | Satisfied | Succeeded |
| `neutral` | Satisfied | Blocked | Neutral |
| `skipped` | Satisfied | Blocked | Skipped |
| `failure` | Blocked | Blocked | Failed |
| `cancelled` | Blocked | Blocked | Cancelled |
| `timed_out` | Blocked | Blocked | Timed out |
| `action_required` | Blocked | Blocked | Action required |
| `stale` | Blocked | Blocked | Stale |

This follows [GitHub's required-check conclusion behavior](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).
It does not make the native API a GitHub Checks REST endpoint. Native trusted
reporters may report these terminal states; `stale` is not an automatic age timer.
Unknown conclusions and lifecycle words in a check result are rejected. Duplicate
check names are rejected rather than letting a passing duplicate hide a failure.

A required check still needs a completed run for the **exact current candidate
and comparison base**, the configured name, and any required repository-local
runner source. A neutral or skipped result cannot erase a source pin, conflicting
source policies, revocation of a pinned source, or a changed candidate/base.
Pre-open checks and final serialized merge use the same evaluator. A missing
result remains blocking, including when an entire workflow is excluded; no
synthetic skipped result is created to fill a missing required name.

The legacy reserved `staging` check remains a verified deployment gate. It needs
`success` plus the existing deployment/version/real-service acceptance evidence;
neutral/skipped cannot replace that receipt. Named required deployment
environments also require their actual successful deployment reports. Deployment
reports retain their separate `success`/`failure`/`cancelled` contract.

## Success-only migration policy

The original [Meld protection acceptance](https://github.com/justrach/nanohubbies/issues/2)
and [CI acceptance](https://github.com/justrach/nanohubbies/issues/3) require a
successful isolated check, with skipped results blocking landing. Set
`successOnlyChecks: true` on the applicable branch protection, or select
**Require Success for all required checks** under Settings → Rules.

This explicit native extension applies to every named `checks` and `beforeOpen`
requirement. Both the PR preview and final serialized writer use the same
conclusion evaluator. It accepts only `success`, preserving source pins,
current candidate/base binding and latest-attempt authority. It does not rewrite
neutral/skipped reports, create a missing result, change runner permissions or
waive deployment/version evidence. A newer queued, running, skipped, neutral,
failed or cancelled rerun cannot inherit an older successful result for the same
SHA. Invalid or unverifiable reports remain blocking.

Ordinary existing policies omit the flag and retain GitHub-compatible behavior.
Matching protections combine: one success-only rule makes the effective
requirement strict; a more specific permissive rule cannot weaken it. Explicit
`false` changes only that stored rule, while other matching requirements remain.

The existing `protections:write` CLI grant supports full JSON export/edit. Keep
`successOnlyChecks` when editing an export. A replacement that omits it from an
already strict stored policy is rejected, including at the final serialized
writer; choosing `false` must be explicit. Admin deletion remains available
through the existing revision/confirmation flow. No new CLI release is needed.

The stateful protection receiver advertises
`successOnlyCheckConclusions: true`. Browser and CLI writers refuse either an
explicit true or false on an older receiver with retryable 503, rather than
letting it discard the new field. After enabling strict policies, retain an
aware application on rollback: an earlier enforcement build does not implement
this gate. Disabling or changing protection remains an explicit admin action.

Run `bun run --filter @swarm/api test:success-only` for the new unit and real
Worker/Git/standalone-CLI acceptance. See
[validation](evidence/success-only-checks-validation.md).

## Runner behavior

The trusted Codegraff dispatcher records an unexecuted dependency job as
`skipped` when a prerequisite does not succeed. An actually revoked or cancelled
lease remains `cancelled`; an exhausted job/lease deadline is `timed_out`, with
sandbox cleanup still required. Failed prerequisites remain separate failed
results. Protect the prerequisite's check name if that work must succeed: as on
GitHub, requiring only its skipped dependent does not require the prerequisite.
The supported workflow dialect still excludes arbitrary conditional expressions.
Success-only mode also blocks a required skipped dependent; protect all required
prerequisites or enable this mode for an aggregate gate.

A deferred deployment may retain ordinary success/neutral/skipped checks, but no
blocking result. Staging dispatch still performs its actual deployment and
version/acceptance verification before recording successful staging evidence.
A finished callback remains idempotent only for the same exact result payload.
Changing a conclusion requires a new authorized retry attempt.

## Actions and CLI

Actions displays the terminal conclusion for each check and an aggregate run
label, while retaining the lifecycle separately. Blocking conclusions take
priority in the native aggregate; otherwise neutral/skipped stay visible. The
aggregate is a display summary, not the required-check evaluator. PR protection
panels list each named current result, so accepted neutral/skipped states are
visible to reviewers.

`nh run list` / `nanohub run list` shows, for example, `complete / neutral` or
`complete / timed_out`; mixed results list each distinct reported conclusion.
`--json` preserves the native run and every original
result state. CLI v0.4.3 includes this rendering in its portable Bun bundle.

Run `bun run --filter @swarm/api test:checks` for source/conclusion unit checks
and the real Worker, Git and Bun CLI smoke. See
[validation evidence](evidence/check-conclusions-validation.md).
