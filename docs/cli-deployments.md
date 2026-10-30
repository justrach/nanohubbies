# Deployment requests and reviews from the CLI

CLI **0.4.17 and its deployment API are published**. See the
[release evidence](evidence/cli-deployments-release-validation.md) for frozen
Linux acceptance, public installation, consent and repository preservation.
The [local tests](evidence/cli-deployments-validation.md) cover real Worker/Git
mutations; this release's hosted check does not issue a production credential or
submit a deployment review. From this checkout, `bun run nh -- ...` and
`bun run nanohub -- ...` also run the commands.

The commands operate on existing deployment requests and environment gates:

```sh
nh deployment list -R owner/repository --limit 25 --json
nh deployment view REQUEST_ID -R owner/repository --json
nh deployment request RUN_ID --environment staging -R owner/repository
nh deployment approve REQUEST_ID --revision 0 --body "Reviewed this candidate" -R owner/repository
nh deployment reject REQUEST_ID --revision 0 --body "Do not deploy this candidate" -R owner/repository
```

Inspect the request's head, trusted base, source ref, run generation, environment,
reviewers, wait timer and revision before reviewing it. `--revision` must be the
value actually observed in `deployment view`, not the global environment-settings
revision. List pagination uses `--before` with the returned `nextCursor`; page
sizes are 1–50 and default to 25.

## Permissions

| CLI scope | Allowed operation | Current access required |
| --- | --- | --- |
| `read` | List and inspect requests | Repository membership |
| `deployments:write` | Request deployment of an existing current CI run | Writer, admin or owner |
| `deployments:review` | Approve or reject as the credential's account | Current configured environment reviewer; native readers are eligible |

Connected Codegraff team members can request and review through their current
provider membership. Reviewer eligibility still comes from the environment;
being an owner, admin or writer does not grant an implicit approval bypass.

Request either new scope explicitly during browser/device login or manual
credential creation. Neither is included in the CLI's default login permissions.
Existing PR-review, environment-administration, merge, Git or runner grants gain
no deployment permission. An approval grant delegates an account decision to its
holder; it is not evidence of human presence and does not count as a PR review.

```sh
nh auth login -R owner/repository --scopes read,deployments:review --days 1
```

Requesting a deployment and reviewing one are independent permissions. A reviewer
grant provides no Git push, environment-policy editing, CI result reporting,
runner authorization or secret-value access. Successful approval records a
decision; the trusted runner still needs current authorization before executing.

## Enforcement and retries

The gateway binds the credential to its host and immutable repository ID and
checks current access. The sequencer obtains fresh native/provider role and
reviewer evidence, then re-reads the credential's owner, repository, origin,
scope, expiry and revocation. Expiry and membership-proof freshness are checked
again at the serialized mutation. Candidate/ref/base/generation, current
environment revision, configured reviewers, self-review prevention and wait
timers retain the existing deployment enforcement.

Reviews use `If-Match: "deployment-request-N"`. A changed request rejects a new
decision with HTTP 412; two different reviewers cannot both mutate the same
observed revision. Each account has one decision per request across its browser
and CLI credentials. An exact repeat of its already-recorded decision/comment
is idempotent and creates no additional audit event. A conflicting repeat is
rejected. Idempotence does not permit expired, revoked or removed-account access.

A repeated request for the same current run, environment revision and generation
reuses the existing request. Unknown mutation responses are never automatically
replayed: inspect `deployment list` and `deployment view` first. Reading a stored
approval does not establish that its candidate is still current or deployable.

Rejection completes a run that is waiting on that exact request with a failed
environment result. Approvals do not shorten wait timers or change repository
locks, required checks or branch/tag deployment restrictions. Archive fences
block mutations and new write/review grants while preserving authorized reads.
Current reviewer membership is checked again when a waiting run resumes and
when protected deployment evidence is accepted.

Request/review changes and their audit records share the sequencer transaction.
Audit retains the actor and CLI credential ID, not the token. JSON cannot select
another actor, credential, authorization receipt or candidate. Older/mismatched
sequencer receivers stop with 503 instead of falling back to browser mutations.

## Limits

This adds CLI control of the existing deployment gate. It does not execute a
deployment adapter, activate unattended Actions, expose secret values, implement
`jobs.environment`, or complete Meld staging/cutover acceptance. The local tests
use real Workers/Git and authenticated synthetic deployment reports, with a
simulated membership provider; they are not cloud execution or production
capacity acceptance.
