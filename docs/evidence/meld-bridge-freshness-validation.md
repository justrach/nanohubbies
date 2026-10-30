# Meld bridge freshness and observation recovery — 2026-10-30

The bridge now dispatches a fresh Meld controller job for each Nanohub attempt
and binds acceptance to that acknowledged job, candidate, workflow base, run kind
and mirror ref. An earlier pass for the same SHA cannot satisfy a fresh attempt.
A newer same-SHA job, including queued/failed work, invalidates an older result.
Cleanup/reporting remain pending; all seven committed pipeline stages must have
exit code zero before acceptance.

An acknowledged receipt can be reopened without another push or dispatch POST.
Unacknowledged operations stay closed for operator reconciliation. Private
receipts exclude controller credentials and signed source URLs. Build reports
link to the actual authenticated controller build log.

## Local evidence

Source: `b790981e19771b13ce20b9ffdde99f4bffda1a22`, following
`ef119d1b77d248276ddf03cd7d8e9fce20b0dd88` and
`6dc1fd838fb0e4f4dd86801cbdfcb835c7a6dcd1`.

- Node and Bun bridge tests: **22 pass each**.
- API unit tests: **391 pass**.
- `bun run check`: three workspace tasks pass, using pinned tsrs; operator
  binding/syntax checks cover ten entrypoints. This is not full operator typing.
- `git diff --check`: pass.

The bridge tests cover concurrent delivery, restart receipts, lost push/POST
acknowledgements (including a real HTTP socket reset), current-attempt binding,
supersession before/following a terminal observation, complete stage evidence,
controller response bounds and private-response sanitization. They also cover
GET timeouts, connection resets, broken response streams and transient HTTP
statuses; recovery after a failed final read; permanent authorization/schema
errors; and outage/late-response rejection at the original deadline. Read
recovery never dispatches again or extends that deadline.

## Live attempts

The source is the actual committed Meld candidate
`77d528a0786106c8e943fee220c421b842a46a19`: one branch and **16,974 reachable
objects**. This is not a new all-178-ref migration acceptance.

The published CLI 0.4.17 imports the graph into a real **isolated local** Nanohub
Worker/DO/D1/R2 fixture. Membership uses a synthetic local identity provider.
The runner claims the native CI run and clones its source with a scoped native
Git read lease; import authority is revoked before CI. The bridge then uses the
existing actual Meld controller and its existing Codegraff account. GitHub
remains the temporary CI transport mirror.

1. The first setup failed before CI dispatch because a test runner label
   contained spaces. No cloud job or mirror ref was created.
2. The corrected setup imported the graph and dispatched external job
   `1793357891890-e2c2fef3-1e30-48cf-bce2-0277e6a67548`. Its seven real stages
   passed. A controller GET timed out, so the old adapter reported a native
   `runner: failure`; **this end-to-end attempt failed**, despite the external
   pass. It is not reused as successful acceptance.
3. A fresh attempt at `b790981`, native run
   `469c322e-78fe-4f32-95e2-166eebd3155c`, dispatched external job
   `1793372611784-ba2c09c7-1a47-4469-8ade-df5afcf57f04`; at 15:04 UTC it is
   building. It deliberately injects one
   synthetic controller GET timeout after a real dispatch acknowledgement, then
   observes that same job. Native callback acceptance and final cleanup remain
   pending until its terminal receipt is inspected.

For attempt 2, the real stage results were: install 5,436 ms; policy checks
378 ms; typechecks 1,119 ms; unit/package checks 129,557 ms; browser installation
39,486 ms; browser checks 608,276 ms; production bundle 40,249 ms. All exited 0.
The retained private build log is 249,290 bytes. Its reported suites include
34 and 11 policy tests, 419 API tests, 1,873 passed/201 skipped web tests,
1,359 extension tests, and **444 passed/68 skipped browser tests**. A successful
stage does not establish coverage of those skipped cases.

Independent observation at 14:56 UTC confirms attempt 2's VM is `destroyed`.
The exact owned mirror ref was deleted with an expected-old-SHA lease and its
absence verified. The local runner was revoked and the fixture disposed. Its
before/after main/staging refs and staging version match; neither shared branch
was updated by the test. Private original operation and failure receipts remain
intact, with a separate terminal observation and cleanup receipt.
See the [failed attempt's sanitized receipt](meld-bridge-first-live-receipt.json).

## Remaining scope

This is checks-only work. No staging deployment, database migration, credential
replacement, production Nanohub credential issuance or primary-remote cutover
is performed. The original Meld worktrees remain untouched.

The configured Nanohub Actions key still returned HTTP 403
`sandbox_scope_required` at 15:00 UTC, with no claim/allocation. The existing
Meld key is used only for Meld's existing pipeline and its cleanup observation.
It is not installed as the Nanohub hosted fleet key.

Hosted Nanohub dispatch/callback activation, callbacks for independent external
reruns after the final observation, fresh Nanohub authorization at the external
deployment boundary, real staging/version/changed-behavior acceptance, isolated
PR-head policy acceptance and compliant/rejected application merges remain
open under [issue 3](https://github.com/justrach/nanohubbies/issues/3).
The issue and its dependencies were reread from GitHub on 2026-10-30. Original
remotes and protections must remain until their cutover acceptance is proved.
