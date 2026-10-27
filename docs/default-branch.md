# Default branches and PR targets

Native Git repositories default to `main` when no initial branch is supplied.
Start lets you choose an initial default, including a UTF-8 name. The API accepts
`{ "defaultBranch": "trunk" }` at `POST /api/repos/:owner/:name`, or
`{ "mode": "git", "defaultBranch": "trunk" }` at `POST /api/trunks/:id`.
The destination's initial default must exist among the source's committed refs
when using the batch migration client. Migration never creates a main alias or
renames the source. [Ref syntax and byte limits](git-ref-names.md) apply.

Owners and current admins can select an existing branch in **Settings → Default
branch**. `GET /api/trunks/:id/default-branch` returns mode, defaultBranch,
revision and existing branch names with their observed commits. A same-origin
human admin may `PUT` `{branch,commit,revision}`. The selected commit must still
match, and the settings revision must be current. A stale revision returns 409;
a moved or missing branch returns 400. Refresh branches before retrying.
No automatic retry silently replaces another administrator's choice.
A separately granted CLI credential may select a default through the bounded
CLI gateway described below. Git, agent and CI credentials cannot change this
setting. Archived
repositories reject it. Snapshot workspaces keep their existing main landing.

Selection changes the symbolic Git HEAD, default file browsing, default branch
creation source and the base for new PRs without an explicit target. Existing
PR targets, Git refs, commit IDs and exact-name protection patterns are retained.
The selected default cannot be deleted. Open PRs still prevent deletion of
their source or target. No branch rename or mass PR retarget is implied.
This follows GitHub's distinction between the
[default for new PRs](https://docs.github.com/en/pull-requests/reference/branches)
and [selecting an existing default branch](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-branches-in-your-repository/changing-the-default-branch).

`~DEFAULT_BRANCH` rules and protected-branch deployment selection follow the
new default. Selection invalidates earlier graph-policy proofs, appends a
logical default-history entry and an immutable settings audit event, and
supersedes old-base CI work. It queues current branch heads against the newly
selected trusted workflow commit. Exact policies remain on their named branch;
review their scope when deliberately moving the default.

## Review target versus trusted workflow source

Git PRs may target any existing branch. Final merge proves the current target
is an ancestor of the candidate, then fast-forwards that target to the same
immutable reviewed candidate. The target's current review, CODEOWNERS,
conversation, signature, metadata and ref restrictions are rechecked in the
serialized writer. Merging a stacked parent retargets its dependent PRs to that
parent's target. Snapshot PRs retain their main-only landing behavior.

`run.head` is always the exact candidate checkout. `run.base` is the repository's
current **default commit**, supplying trusted workflow definitions. A candidate
cannot replace a required workflow with its own passing placeholder. The
workflow source can be a sibling of a candidate targeting another branch; it
need not be that PR's merge ancestor. Required checks and deployment evidence
bind to this exact candidate/current-default pair, with current runner source
and authorization checks. Changing the default or moving it makes old-base
results ineligible. Merged PR receipts retain both the actual target base and
`mergedCIBase`, so historical checks remain attributable.

## Deployment and compatibility

Roll out the default-aware Worker and trusted dispatcher together before
selecting a non-main default or merging a non-default PR target. Earlier
controllers required the workflow base to be a candidate ancestor and can
reject otherwise valid candidates. During Worker/DO propagation, default
selection fails with retryable 503 if the new receiver is unavailable; custom
initialization checks receiver capability before writing. Existing main-based
reads preserve compatibility during rollout.

After selecting a non-main default, do not roll back to a main-only application
build. Preserve the new receiver or explicitly restore a compatible default
before a reviewed rollback. The SQLite pointer and settings revision persist
across restart; no objects or refs require rewriting.

Run `bun run --filter @swarm/api test:default`, the full repository and unit
suites, CLI tests, hosting tests, pinned tsrs and the production build. Local
controller checks use an explicitly synthetic trusted adapter; mocked Codegraff
transport tests do not establish a real cloud VM execution.

## Native CLI selection

CLI 0.4.9 adds the [GitHub CLI-style default selection](https://cli.github.com/manual/gh_repo_edit):

```sh
nh repo default-branch -R owner/repo --json
nh repo edit --default-branch develop -R owner/repo
# Optionally require the settings revision you inspected earlier:
nh repo edit --default-branch develop --revision 4 -R owner/repo
```

`repo default-branch` needs only the existing `read` permission. Editing needs a
new explicit `repository:default` grant and a current owner/admin role. It is
omitted from default login permissions and cannot be delegated while archived.
Protection, ruleset, archive, Git and agent grants do not acquire this permission.
It controls only the selected default, not arbitrary settings, ref writes or
branch rename. Browser/device consent labels it separately.

The command reads the current settings revision and the selected branch's exact
commit, then sends one conditional PUT. An explicit `--revision` also checks the
user's earlier observation. The gateway requires matching body and
`If-Match: "default-N"`; missing conditions return 428 and stale settings return
412. Missing/moved branch heads fail before selection. Neither a failed
precondition nor a lost response causes an automatic retry. Inspect the default
again before deciding whether to repeat the command.

Settings and graph revisions have persistent SQLite fences. Legacy SQL writes,
including old manual counter increments, cannot revive an earlier export after
an ABA change. Delete/reinsert also invalidates it. A transaction rollback
restores the pointer and both fences. First installation on an existing Git
repository advances the fences once; revisions are not contiguous edit counts.
The final configuration writer obtains fresh native/provider admin evidence
and binds it to the actor before its serialized transaction. The exact head,
settings revision and archive fence are checked there. Its audit records the
account and CLI credential ID. Current CI/default-rule behavior is shared with
browser selection, including superseding old-base checks and queuing heads
against the new trusted workflow commit.

The stateful receiver must advertise `conditionalWrites`, `cliAudit` and
`revisionTracking: "storage"`. During mixed-version propagation the CLI returns
retryable 503; it never falls back to the browser's older writer. No production
credential is required for the isolated source/bundled CLI acceptance scripts.
