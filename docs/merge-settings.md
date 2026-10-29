# Repository merge settings

Owners and current repository admins can choose allowed pull request merge
methods and a default under **Settings → Pull request merges**. The UI, final
writer and CLI 0.4.15 are deployed. See [behavioral validation](evidence/merge-settings-validation.md)
and [release acceptance](evidence/merge-settings-release-validation.md) for the
exact scope.

The supported values are `fast-forward`, `merge`, `squash` and `rebase`. Enable
at least one method and choose a default from that set. Existing repositories
start with all four enabled and fast-forward selected, preserving their previous
behavior. The default selects the initial browser/CLI choice; contributors may
explicitly select another allowed method. Readers can inspect the configuration.
Legacy snapshot workspaces retain fast-forward and have no editable merge card.

This follows GitHub's [repository merge-option control](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github):
enabling only squash enforces squash for PR merges. Nanohub additionally exposes
its existing fast-forward method and a repository default. It does not copy
GitHub's initial merge-commit default or claim complete settings/API parity.

## Independent restrictions

The allowlist applies to PR merges, including browser and native CLI requests.
It does not ban ordinary Git fast-forward pushes; use branch protections and
rulesets to require a PR or lock a branch. Changing merge settings does not move
refs, alter the default branch or edit any protection.

Every allowed method still passes current membership, archive, branch locks,
review/CODEOWNERS/conversation, trusted checks, deployment, signature, file,
metadata and graph requirements. Generated commits remain unsigned. When
signatures are required, the browser offers only enabled fast-forward; if it is
disabled, the UI explains why no method is available. The server remains the
authority if rules change after the page loads.

## Native CLI

CLI 0.4.15 adds separate current-admin permission `repository:merge`. It is not
included in default login scopes and existing grants gain no administration
rights. The server checks the current role again at the final settings writer.

```sh
nh auth login -R owner/repo --scopes repository:merge
nh repo merge-settings -R owner/repo --json
nh repo edit -R owner/repo \
  --allow-merge-methods fast-forward,squash \
  --default-merge-method squash --revision 0
```

Use the revision returned by the read; `0` is illustrative. Both flags replace
the complete configuration. A conflicting revision is refused. Read access alone
can inspect settings, and merge permission alone cannot administer them.

With the ordinary `pulls:merge` permission, `nh pr merge N` observes and sends the
repository default plus settings revision. Explicit `--merge`, `--squash`,
`--rebase` or `--method fast-forward` must also be allowed. Custom `--message`
still requires an explicit merge/squash selection. The CLI never retries an
uncertain mutation or changes strategy silently; inspect `repo merge-settings`
or `pr view` after a lost answer. Older servers without settings retain the
CLI's legacy fast-forward default.

## HTTP and storage contract

`GET /api/trunks/:id/merge-settings` and its owner/repo alias return
`allowedMethods`, `defaultMethod`, `revision`, repository mode, archive/manage
hints and capability flags `conditionalWrites`, `cliAudit` and
`revisionTracking: "storage"`. Responses are private, non-cacheable and have
ETag `"merge-settings-N"`. CLI uses `/api/cli/repos/:owner/:repo/merge-settings`
or the existing CLI trunk addressing form.

`PUT` requires a same-origin signed-in owner/admin session or the separately
scoped CLI identity. The body contains exactly `allowedMethods`, `defaultMethod`
and the observed nonnegative safe-integer `revision`, within 2 KiB. CLI writes
also require `If-Match: "merge-settings-N"`: missing is 428, inconsistent is 400,
and stale is 412 (browser stale writes use 409). Invalid/duplicate/empty lists,
unknown fields and an excluded default are rejected. Archived repositories
cannot change settings. Accepted changes audit previous/next values, actor and
CLI credential identity; a no-op does not advance the revision.

Settings have a separate persisted revision. SQLite triggers observe changes,
including raw updates, deletion/reinsertion and ABA changes. Trigger repair
invalidates prior observations. Missing/corrupt stored settings or an invalid
revision close the merge path rather than restoring permissive defaults.

PR snapshots expose settings and allowed methods. Git merge requests use the new
`mergePullWithSettings` receiver, binding the observed revision to the final
serialized merge transaction. A settings change during object preparation is
rejected there, with the target and PR still unchanged. Lower-level merge ref
updates independently check the current allowlist. After the first settings
change, legacy commands without a revision cannot merge. A missing receiver
returns retryable 503 and never falls back to the older writer.

If a caller omits a method, HTTP resolves the current repository default. A
generated method still needs the observed target SHA; older clients lacking that
observation must refresh/upgrade rather than merge an unobserved target.

## Remaining parity and release work

The existing strict up-to-date target requirement, linear automatic-rebase
limits and unsigned generated commits remain. GitHub message templates,
automatic coauthor trailers, divergent three-way merges, branch-specific merge
method rules, merge queues and full GitHub API equivalence are not implemented.
Frozen Linux release gates, verified rollout and live settings/archive smoke
now pass at nanohub.sh. This does not close the separate Actions, application
staging, changing-Git recovery or traffic-readiness gates. An inactive held
release is retained as a request fence; rolling back to code without these
settings must not silently waive a saved allowlist.
