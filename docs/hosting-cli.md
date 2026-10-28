# Nanohub CLI

The hosting CLI is available as `nh` and `nanohub`. The macOS/Linux installer
requires Bun 1.4 or newer, and Git must be available for repository operations.
Download the installer, then run it with Bun:

```sh
curl --fail --silent --show-error --proto '=https' https://nanohub.sh/nh/install.mjs -o install-nh.mjs
bun install-nh.mjs
nh --version
nh auth login -R owner/repository
nh repo clone owner/repository
```

The installer verifies the release's byte length and SHA-256 against the same-host
[release manifest](https://nanohub.sh/nh/latest.json). It writes the portable
module into `~/.local/share/nanohub-cli/VERSION-CHECKSUM/` and managed launchers
into `~/.local/bin`. Add that bin directory to PATH if needed. It never edits
shell profiles, installs Bun, changes global Git configuration or replaces an
unrelated `nh`/`nanohub` command. If the older swarm CLI occupies either name,
choose a separate prefix with `bun install-nh.mjs --prefix ~/.local/nanohub-hosting`
and use its `bin` directory. Windows launchers and standalone runtime binaries
are not packaged yet.

Rerun the installer to update its own launchers. Old installed modules are
retained so existing checkout helpers still work; run `nh auth setup-git` inside
a checkout to switch its helper to the new installation. Keep the Bun executable
available at its installed path. Releases are built with the
[Bun bundler](https://bun.sh/docs/bundler) and have no npm runtime dependencies.
The new `/nh/` distribution does not replace the older `/install.sh`, `/cli` or
`/download` swarm endpoints.

Contributors can also run the CLI from this checkout:

```sh
bun run nh -- --help
bun run nanohub -- --version
bun run nh -- auth login -R owner/repository
bun run nh -- repo clone owner/repository
bun run nh -- pr view 12 -R owner/repository
bun run nh -- run list -R owner/repository
bun run nh -- rules view -R owner/repository
```

`repo clone` uses native Git. PR and Actions commands use the CLI API by default.
`pr view --web` opens the signed-in browser's bounded hunk reviewer;
`rules view` opens protection settings. Native `rules list/get/set/delete` are
described below. `--print` returns a browser destination for list/view
commands; `--json` returns command data, or a structured error with nonzero exit.
Inside a checkout, omit `-R` to infer the repository from `origin`.
`--host` selects an HTTPS origin; HTTP is allowed only on loopback. `--trunk ID`
supports older workspace addresses without owner/repository aliases.

This is not the full GitHub CLI command surface. Account-wide API credentials
and standalone native executable releases remain
future work. The older Zig `nanohub swarm` CLI lives in the
separate Nanohub checkout and is not replaced or installed by this change.

## Git through CLI login

A new CLI credential can include `contents:read` for clone/fetch and
`contents:write` for push. Push also requires clone/fetch. Browser login requests
both explicitly; review the permissions before authorizing. Existing credentials
keep their original permissions and gain no Git access.

```sh
nh auth login -R owner/repository --scopes read,contents:read,contents:write
nh repo clone owner/repository
# Or, from an existing checkout whose origin matches this repository:
nh auth setup-git
```

Cloning with a content-scoped CLI credential installs a repository-local Git
credential helper that calls this CLI installation. Keep the Bun executable and
CLI source path available. Moving the installation requires running
`nh auth setup-git` again. The helper reads the existing API entry in the selected
OS helper; it does not copy the token into Git config or remotes. Environment-only
`NANOHUB_API_TOKEN` credentials remain environment-only, so keep that variable
available for later Git operations. Global Git settings are untouched.

The helper answers only for the exact protocol, host, repository path and Git
username, and refuses HTTP redirects. Ordinary Git clone/fetch/push still checks
current membership, scopes, expiry, revocation, archival, locks and protections.
CLI credentials cannot use browser-only rule bypass. `auth logout` revokes the
same credential for both API and Git; an already-invalid credential can still be
removed from its local API helper entry.

Use `nh repo clone owner/repository --git` to select an independent Git token,
including when an API-only CLI credential is already stored.

## Separate Git credentials

`auth login --git -R owner/repository` opens the repository's Git access page. Create a
repository-scoped Git token there. `auth login --with-token -R owner/repository`
reads that token only from stdin; use your password manager or secret input
mechanism to supply it, rather than placing it in command history or arguments.

The CLI verifies Git read access before saving anything. It uses `osxkeychain`
on macOS or `manager` elsewhere; `--credential-helper` also accepts `libsecret`
or the temporary memory `cache`. The helper must already be installed. Plaintext
credential storage is unsupported. Storage and lookup include the exact host
and repository Git path. The temporary verification helper is bound to that
protocol/host/path and receives the token through a child environment variable.
The token never enters a remote URL, command argument, CLI output or repository
configuration. Successful storage is checked without printing the credential.

Clones using separate Git credentials configure the selected helper and `credential.useHttpPath` locally;
global Git configuration is not changed. Normal Git push/pull then use the same
repository credential and the server's existing ACLs, expiry, revocation, repository archival, locks,
branch protection and merge restrictions. The Git token gains no application
API, review, collaborator, runner-administration or secret privileges.

```sh
bun run nh -- auth status --git -R owner/repository
bun run nh -- auth logout --git -R owner/repository
```

Git status verifies Git read access. Git logout removes the credential from the selected
local helper. It does **not** revoke the server token; revoke that separately
on the repository's Git access page. The CLI does not extract browser sessions.

## Browser authorization

`nh auth login -R owner/repository` now starts browser authorization. It prints
an eight-character user code, opens the selected host's `/cli/authorize` page,
and waits for you to sign in, check the code, repository, requested permissions
and expiry, then authorize or deny. Sign-in alone never grants access. The CLI
requests read, clone/fetch, push, PR creation/closing, review/conversation and merge permissions
for this repository; you may remove optional permissions or shorten the expiry
in the browser. Roles, archive and branch rules continue to apply.

```sh
nh auth login -R owner/repository --scopes read,reviews:write --days 1 --label "Review laptop"
nh auth login -R owner/repository --no-browser
nh auth status -R owner/repository
nh auth logout -R owner/repository
```

Default expiry is seven days; `--days` accepts 1–30. `--no-browser` prints the
same instructions without launching a browser, useful over SSH. Instructions
go to stderr; `--json` keeps one final JSON result on stdout. `auth status` and
`auth logout` now default to API credentials; `--api` remains an explicit alias.
Use `--git` for separate transport credentials. `auth login --web` still opens
manual setup, and stdin token login remains available.

The native JSON protocol follows the consent and polling behavior in
[RFC 8628](https://www.rfc-editor.org/rfc/rfc8628#section-3.5), rather than claiming
general OAuth server compatibility. `/api/cli/device` accepts the target, label,
scopes and expiry without revealing whether a private repository exists. The
256-bit device code stays inside the CLI; only a short user code enters the
browser URL. Pending requests expire after ten minutes. Human session,
same-origin mutation, fresh membership, requested-scope and expiry checks guard
consent. Public code creation and signed-in code lookups have separate rate
limits. Polling begins at five seconds, slows on early polling/network failure,
and stops on denial or expiry. Only an explicitly configured loopback frontend
may differ from the API's verification origin during local development.

Approval records the grant; the device secret is still required to mint the
credential. One D1 transaction issues at most one credential. A lost token
response may be recovered for up to two minutes within the request's lifetime,
using the same derived token; neither its plaintext nor the device/user codes
are stored. Revoked credentials cannot be recreated by replay. Membership and
scope are checked again before issuance. If local helper setup fails, the CLI
tries to revoke the newly issued grant and reports any cleanup failure.

## CLI API credentials

In **Git access → Nanohub CLI**, create a named credential for the current
repository, valid for 1–30 days (the UI defaults to seven). Read is mandatory;
Clone/fetch, push, PR creation/closing, reviewing/conversations, merging and
branch protection management are separately chosen. Readers and archived repositories can grant metadata read
and clone/fetch; write scopes require current write access and an active repository. Values
are shown once. Cloudflare D1 stores SHA-256 digests and minimal account identity,
not the plaintext token or a browser session. This is a native credential flow,
not OAuth; its Authorization bearer transport follows
[RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1).

Feed the `nhc_` value through stdin to
`nh auth login --with-api-token -R owner/repository` using a secret input tool.
The CLI verifies the target repository before saving to the selected OS helper.
API credentials use their own `api/cli/owner/repository` path and username,
separate from Git credentials. `NANOHUB_API_TOKEN` may instead supply the API
credential for an automation process. Tokens never belong in command arguments,
URLs or Git remotes. API fetches refuse redirects and omit browser cookies.

```sh
nh auth status --api -R owner/repository
nh pr list -R owner/repository --json
nh pr create -R owner/repository --head feature --title "Handle empty input"
nh pr view 12 -R owner/repository
nh pr diff 12 -R owner/repository
nh pr review 12 -R owner/repository --verdict approve --body "Reviewed"
nh pr comment 12 -R owner/repository --path src/parser.ts --line 24 --body "Check empty input"
nh pr resolve 12 -R owner/repository --thread COMMENT-ID
nh pr merge 12 -R owner/repository
nh auth logout --api -R owner/repository
```

`pr comment` supports `--start-line`, `--side left|right`, or `--reply-to ID`.
Ranges must fit within one visible hunk, at most 201 lines. `pr resolve --reopen`
reopens a thread. Diff output is bounded by the server and labels omitted/binary
patches. `pr close` closes a PR; `run list` reads stored Actions history.

The gateway permits only the documented native read/PR/conversation/protection operations, checks
the token's origin, immutable repository ID, expiry, scopes and current
membership, and delegates to the existing serialized protection writers. A CLI
review is an explicitly delegated account review, marked **via CLI**, rather
than proof that a human typed it. Self-approvals still cannot count; fresh writer
membership, CODEOWNERS, stale-review, latest-push and conversation gates apply.
CLI credentials never receive browser-only ruleset bypass, unrelated administrator APIs,
secrets or private browser drafts. Runner administration requires its separate
explicit owner-only permission described below. Git transport requires
the separate, explicit content scopes described above.
Existing Git-only and registered-agent credentials gain no CLI API rights.

### Private pending reviews

CLI **0.4.14** includes private batch reviews introduced in 0.4.13. The
[release validation](evidence/merge-methods-release-validation.md) records the
frozen Linux gates, production delivery and real installer checks. Like
[GitHub pending reviews](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/reviewing-proposed-changes-in-a-pull-request),
comments remain private until submitted together with Comment, Approve or
Request changes. The server publishes the verdict, anchored comments and retry
receipt in one SQLite transaction.

```sh
nh pr draft 12 -R owner/repository --json
nh pr comment 12 -R owner/repository --draft --revision 0 --path src/parser.ts --line 24 --body "Check empty input"
nh pr draft 12 -R owner/repository --json
nh pr draft 12 -R owner/repository --edit COMMENT-ID --revision 1 --body "Clarify the empty-input behavior"
nh pr comment 12 -R owner/repository --draft --revision 2 --path src/reader.ts --start-line 8 --line 10 --body "Handle this range too"
nh pr review 12 -R owner/repository --pending --revision 3 --verdict request-changes --body "Two issues to address"
```

Use the revision returned by `pr draft` or the preceding accepted operation;
0 starts a new draft. `pr draft --remove COMMENT-ID --revision N` removes one
comment; `pr draft --discard --revision N` discards the review. Edits and
publication require the exact observed revision. Draft comments use the same
201-line, single-visible-hunk limit as published comments, with at most 100
comments and 1 MiB of retained draft data. Pending replies are unsupported.

Every explicit pending-review read or write requires **reviews:write** and
current repository writer access. Ordinary `read`, Git-only and agent tokens
cannot inspect it. Each CLI credential owns a separate private workspace under
its bound account; neither a sibling credential nor the same account's browser
can read/edit that workspace. Existing browser drafts remain account-private
and are not exposed to CLI credentials. Replacing a credential does not transfer
its draft. Ordinary PR/list output excludes private CLI drafts.

Protected merge status can report that a related open PR at the same commit has
a pending review; it exposes the PR number and status, without the draft's
author, credential or content. Submit/discard that review or close the related
PR to clear the blocker. See [shared-head reviews](github-parity.md#reviews-on-another-pr-at-the-same-commit).

A push or changed comparison leaves old feedback private. Submission uses the
draft's original head and comparison; the CLI never replaces them with newer
IDs to make a stale review pass. Inspect and discard the old draft before
starting on the new diff. Reads remain available to current writers while
archived, but every draft mutation and publication is denied. Demotion,
membership removal, credential expiry or revocation denies draft access.

Published reviews and threads identify the owning account and issuing CLI
credential. Self-approval, current independent reviewers, CODEOWNERS and
conversation-resolution rules still apply. A lost response never triggers an
automatic write retry: inspect `pr draft` and the public PR first. Exact server
submission retries return the original receipt; another credential or changed
payload cannot reuse it. See [validation](evidence/cli-pending-validation.md).

Dedicated CLI draft RPC entrypoints prevent an older browser-only receiver from
ignoring credential isolation during deployment propagation. Such a receiver
cannot read or mutate a browser draft on the CLI's behalf; retry after rollout.

## Merge methods from the CLI

CLI **0.4.14** adds explicit history choices:

```sh
nh pr merge 12 -R owner/repository --merge
nh pr merge 12 -R owner/repository --squash --message "Handle empty input (#12)"
nh pr merge 12 -R owner/repository --rebase
nh pr merge 12 -R owner/repository --method fast-forward
```

In published CLI 0.4.14, omitting the method uses fast-forward. The local 0.4.15
candidate instead observes the repository default when the server advertises
merge settings, retaining fast-forward on older servers. Choose one
flag or one `--method` value. `--message` is available only with merge/squash,
must be nonempty without NUL and is limited to 64 KiB UTF-8. The browser editor
has a 16,000-character input limit. Rebase preserves the original messages.

The CLI first observes the exact PR head/comparison, advertised methods and
current target SHA, then sends one conditional request. A changed target fails;
the CLI does not silently retarget, change method or retry after a lost answer.
Inspect `nh pr view --json` to distinguish the original `headCommit` from
`mergedCommit` and `mergeMethod`. Old receiver/policy capabilities are checked
before requesting a generated method.

These methods preserve the exact reviewed tree and currently require an
up-to-date feature branch. Reviews, same-head peer blockers, CI, deployments and
all branch/ruleset restrictions remain enforced. Generated commits are unsigned;
signing requirements need fast-forward. Automatic rebase requires linear
feature history and is bounded at 200 commits/16 MiB of commit metadata.
Neither the source ref nor its existing Git objects are rewritten.

The published CLI is **0.4.14**, including private reviews added in 0.4.13.
See [behavioral validation](evidence/merge-methods-validation.md) and
[release evidence](evidence/merge-methods-release-validation.md). Generated Git
merges and private-review mutations are covered by local and frozen Linux
Worker tests; this release's production checks preserve existing canary state.

### Repository merge configuration (local CLI 0.4.15)

`nh repo merge-settings -R owner/repo --json` reads allowed methods, the default
and its revision. A current admin with the separate explicit `repository:merge`
permission can replace the configuration:

```sh
nh auth login -R owner/repo --scopes repository:merge
nh repo merge-settings -R owner/repo --json
nh repo edit -R owner/repo --allow-merge-methods fast-forward,squash \
  --default-merge-method squash --revision 0
```

Use the observed revision; `0` is an example. Both settings flags are required,
and the default must be enabled. Default login grants exclude this permission.
Archived repositories, changed roles, stale revisions and older receivers are
refused. A lost response is not retried: inspect `repo merge-settings` before
another edit. Ordinary merge requests bind the observed settings revision and
generated methods also bind the current target SHA. Branch protections remain
independent. See [the full contract](merge-settings.md) and [local validation](evidence/merge-settings-validation.md).
This version is built locally; the published version remains 0.4.14.

## Branch protections from the CLI

CLI v0.4.5 adds `rules list`, `rules get`, `rules set` and `rules delete` for
classic branch protections. `rules view` keeps opening the browser settings page.
Rulesets, environments and runners have separate native commands and explicit
permissions described below. History restoration uses its existing settings page.

Members with CLI `read` can list/export protections. Edits require an explicit
**protections:write** permission and a current owner/admin repository role.
This separates protection administration from Git push and reviews, following
[GitHub's admin requirement](https://docs.github.com/en/rest/branches/branch-protection).
The native scope name/API is not GitHub's REST schema or a general administration
grant. Default browser login does not request this permission; old credentials
gain no new scopes. Manual creation, device consent, token issuance and every
edit verify the current role. Demoting an admin immediately denies edits.

```sh
nh auth login -R owner/repository --scopes read,protections:write --days 1
nh rules list -R owner/repository
nh rules get 'release/**' -R owner/repository --json > protection.json
# Edit the complete policy in protection.json, retaining its revision.
nh rules set --file protection.json -R owner/repository
nh rules delete 'release/**' -R owner/repository --revision 12 --confirm 'release/**'
```

`rules get` matches an exact stored pattern, not all rules applying to a branch.
Its export is `{revision,policy}`; replacing the policy can both strengthen and
remove requirements. To add a new rule, copy an export and change its branch
pattern, or create the envelope using the revision from `rules list` and the
complete [protection fields](github-parity.md#protection-api). Quotes preserve
shell wildcards. Put options before `--` when addressing a pattern beginning
with a dash, for example `nh rules get -R owner/repository -- -leading`.

Every successful protection edit, including browser edits, increments one
repository-local protection revision. CLI writes send the exported revision as
`If-Match: "protection-N"`. The final sequencer transaction compares it before
changing the policy and recording the actor, before/after value and CLI
credential ID. This follows the
[HTTP conditional-write model](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.1).
Missing preconditions return 428, malformed revisions 400 and stale revisions
412. A concurrent browser or CLI edit invalidates the export; inspect it again
and reconcile the changes. Lost responses are never automatically retried.
The browser's existing unconditional edits remain supported and advance the
same revision; the CLI does not silently turn them into conditional requests.

Revision tracking lives in persistent SQLite insert/update/delete triggers, so
older application builds also invalidate exports when they write protection
data. Installing this fence advances an existing counter once; re-export saved
files after that upgrade. Revisions are opaque, increasing integers: they may
have gaps, including when older code also increments its application counter.
Returning to identical policy contents never revives an old revision. The
policy and its counter roll back together if a write transaction fails.

The gateway uses `GET/PUT/DELETE /api/cli/repos/:owner/:repo/protection` (or the
immutable `/trunks/:id` alias). Reads return `{policies,revision,revisionTracking}` and the
corresponding ETag. PUT accepts a full policy; DELETE accepts `{branch}` only.
Edits preserve ordinary validation, overlapping rules, archived-repository
fences and final Git/merge enforcement. They do not grant content-write access
or bypass rights. The file reader accepts UTF-8 exports up to 128 KiB; the API's
32 KiB canonical policy-body bound still applies. Protection activity labels
these edits **via CLI**. See [validation](evidence/cli-protections-validation.md).
`revisionTracking: "storage"` confirms the persistent fence is installed. During
a mixed-version rollout, native reads and edits wait with 503/Retry-After until
the receiver advertises that capability. Existing browser reads stay available.

API logout revokes the server credential before removing the local helper entry,
including after repository membership is removed. It leaves separate Git
credentials alone. Revocation is also available beside the credential in Git
access, or to its signed-in owner through `DELETE /api/cli/credentials/:id`.
Account listing (`GET /api/cli/credentials`) requires a browser session; tokens
cannot mint or list other credentials. Do not automatically repeat mutations
after a lost response: inspect the PR first to avoid duplicate review/creation.

## Validation

`bun run test:cli` exercises parsing, host/credential boundaries, remote
inference, browser routing, Git invocation and secret handling. The repository
suite additionally runs `packages/api/scripts/smoke-hosting-cli.ts`: a real Bun
process against local Workers, stdin login into an isolated memory helper,
status, clone/fsck, native push rejection on a locked main, archived clone/read access and refusal of pushes to new branches, URL output, logout,
and failed access after removal. Synthetic Git credentials are revoked and the
isolated cache daemon is stopped during cleanup.

`smoke-cli-api.ts` additionally runs actual Bun native API commands against real
Worker/D1/Git fixtures: creation, list/view/diff, close, account review, hunk
comment/resolution and protected merge; scope/origin/repository isolation,
private-draft exclusion, membership removal/demotion, archive/lock/bypass refusal,
credential restart persistence, revocation and expiry, plus exact clone/fsck.

`bun run --filter @swarm/api test:cli-pending` additionally tests source and
standalone bundled CLI collection, editing/removal/discard, per-credential and
browser privacy, exact revisions/hunks, atomic publication and provenance,
stale pushes, restart, scope/demotion/expiry/revocation, archive and protected
merge followed by independent Git clone/fsck.

`smoke-cli-device.ts` covers real Worker/D1 code consent, reduction, denial,
expiry, competing actors/polls, lost response recovery, non-resurrection after
revocation, current reader/demotion/archive boundaries, separate rate limits,
origin binding, restart durability and an actual headless Bun login/status/logout
using an isolated memory helper. Sign-in tests verify that only a normalized
code selects the fixed consent return path; arbitrary return URLs stay ignored.

`smoke-cli-git.ts` exercises actual CLI login, clone/fsck and ordinary Git push
through the scoped helper, including a source path with spaces and an apostrophe,
isolation from inherited global helpers, read-only/current-membership checks,
locks, archive, browser-bypass refusal, setup target matching, redirect refusal
and revocation. The device smoke also checks content-scope dependencies and
reader/archive scope reduction before issuing a grant.

The portable module is also exercised by the complete real Git smoke with
`--bundle`, including ordinary Git's invocation of the installed module as a
credential helper. Installer tests cover real HTTP download, digest/size limits,
redirect refusal, command collisions, managed updates, quoted installation paths
and operation outside the source checkout. `bun run --filter @nanohub/cli build`
regenerates the public manifest, portable module, checksum and installer. Web
builds regenerate these assets automatically.

`run list` text output shows run ID, native state, canonical branch/tag ref and
commit SHA. JSON retains the full native run object. v0.4.2 corrects the previous
text status field and distinguishes same-named branch and tag runs.

## Default PR targets

CLI 0.4.6 omits `base` on `pr create` when `--base` is absent, letting the
server choose the repository’s current default branch. An explicit `--base`
remains exact. Creation returns the highest-numbered newly created PR rather
than an older row in the newest-first snapshot. Default selection is also available through the separately granted CLI
`repository:default` permission introduced in 0.4.9; older grants retain their
existing permissions.
See [default branch behavior](default-branch.md).

## Rulesets from the CLI

CLI 0.4.7 adds native repository ruleset list/view/export/create/update/delete:

```sh
nh ruleset list -R owner/repo --json
nh ruleset view 3 -R owner/repo
nh ruleset export 3 -R owner/repo --json > ruleset.json
# Edit the complete configuration; retain the observed revision.
nh ruleset update 3 --file ruleset.json -R owner/repo
nh ruleset create --file new-ruleset.json -R owner/repo
nh ruleset delete 3 --revision 8 --confirm 3 -R owner/repo
```

List/view use existing metadata read access. Bypass account IDs are returned
only with the explicit `rulesets:write` permission and a current repository
owner/admin role. Complete editing exports require that permission. It is
separate from `protections:write`, is absent from default login, and is never
added to existing credentials. Request it explicitly with
`nh auth login -R owner/repo --scopes read,rulesets:write` or select it in Git
access. Browser/device consent and token exchange both recheck current admin
access. Repository archive blocks edits and new write grants.

An editing file contains exactly `{revision,configuration}`. Configuration uses
the native supported ruleset schema and must explicitly include `bypass_actors`,
including an empty array when none are intended. A redacted member view cannot
silently become a full replacement. Complete exports retain bypass accounts;
the browser's portable **Download JSON** continues to omit them for sharing.
Create assigns a new local ID. Update replaces the complete selected ruleset;
it does not merge omitted fields. Deletion requires the exact selected ID.
All branch, tag, file/path, signature, metadata and deployment rules keep the
same validation, overlap and final Git enforcement as browser settings.

The bounded CLI gateway exposes metadata `GET /rulesets[/:id]`, admin-only
`GET /rulesets/:id/configuration`, and conditional `POST /rulesets`,
`PUT /rulesets/:id`, `DELETE /rulesets/:id`. Mutations send
`If-Match: "ruleset-N"`; create/update accept `{configuration}`, and deletion
accepts `{}`. Missing/invalid conditions return 428/400; a stale revision returns
412 without a write. Current admin role is required on every edit and complete
export. Ordinary read access remains usable after demotion, with bypasses hidden.
These commands cannot administer runners, secrets, collaborators, device grants,
classic protections, or historical restore/import routes.

Ruleset revisions are opaque increasing storage fences. SQLite triggers also
observe older application SQL, and default-branch selection invalidates the same
graph revision. Installing/repairing the fence invalidates old exports once;
rollback to an older writer may create harmless revision gaps. Data, revision
and the CLI-attributed before/after audit commit atomically. A lost response is
never automatically retried. List/export again and inspect state first.

Complete exports and edits require `revisionTracking: "storage"` from the
receiver. During mixed-version rollout, edits use a new conditional RPC and
return retryable 503 if it is unavailable. No unconditional legacy fallback is
used. Read-only metadata remains available. Files have the existing 128 KiB
bounded UTF-8 reader; server envelopes have a 128 KiB bound as well.

The generic complete protection export also preserves `allowForcePush`. With
`preventForce: true`, it contains selected stable account IDs; an omitted or empty
list blocks every force push. The list requires Git repository mode and a
force-aware receiver. It cannot waive other protections. CLI 0.4.7
needs no binary change for this server-supported field; its published module
and checksum remain unchanged. See [selected force-push behavior](github-parity.md#selected-force-push-accounts).


## Repository archive and unarchive

CLI **0.4.8** provides `repo archive-status`, `repo archive` and `repo unarchive`,
corresponding to [GitHub CLI archive](https://cli.github.com/manual/gh_repo_archive)
and [unarchive](https://cli.github.com/manual/gh_repo_unarchive). Inspect the
current revision and repository name before changing lifecycle state:

```sh
nh auth login -R owner/repository --scopes read,repository:archive
nh repo archive-status -R owner/repository --json
nh repo archive -R owner/repository --revision 0 --confirm repository
nh repo archive-status -R owner/repository --json
nh repo unarchive -R owner/repository --revision 1 --confirm repository
```

Use the actual returned revision; it need not equal these examples. The separate
`repository:archive` permission is never included in default login or added to
older grants. Owners/admins must choose it explicitly. Current admin membership
is checked at delegation, device approval/exchange, every mutation and the final
Hub transaction. A content, rule-management or review grant cannot archive or
unarchive. Readers may inspect archive status with `read`.

Archived repositories still permit admins to delegate this lifecycle permission,
so a lost or expired credential does not force browser-only recovery. Content,
review and rule-edit grants remain unavailable while archived. The device consent
screen can reduce a request to `read` plus `repository:archive`; a demotion before
exchange prevents issuing the admin grant. Reopening restores writes only under
the existing protections; it never removes branch locks or retries cancelled CI.
Cloudflare secret values remain retained under the existing vault lifecycle.

The bounded CLI gateway exposes `GET/POST /api/cli/repos/:owner/:repo/archive`
and the older `/api/cli/trunks/:id/archive` alias. POST accepts only
`{archived,revision,confirmation}`, where confirmation is the current repository
name returned by GET. It requires `If-Match: "archive-N"` matching the body.
Missing preconditions return 428; malformed/mismatched headers or names return
400; stale state returns 412. Renaming invalidates an old name confirmation.
Even a completed same-state request must carry a current revision. Interrupted
operations accept their original revision when resuming that same transition.

The CLI sends each mutation once. After a network failure, inspect
`repo archive-status` before retrying. Pending archival keeps writes fenced;
committed reopening reports its pending replica activation. CLI actor and
credential ID survive retries/restarts in the archive transition and appear in
admin activity, once per accepted revision. No bearer value enters the audit.

Mixed-version receivers must advertise conditional lifecycle and final name-confirmation support at the Hub
and CLI audit support at the Sequencer. Earlier receivers return retryable 503;
conditional writes never fall back to the older browser method. Existing browser
archive/retry behavior stays compatible. See
[validation](evidence/cli-archive-validation.md).


### Role actors in complete ruleset exports

CLI 0.4.8 preserves explicit `RepositoryRole` actors with numeric IDs 4 (native
writer) and 5 (native admin/owner) in `ruleset export` and `ruleset update`.
Their modes remain `always` or branch-only `pull_request`. The existing explicit
`rulesets:write` scope and observed ruleset revision are required. Role permission
changes no CLI content/review grant and does not make CLI credentials inherit
signed-browser bypass. Portable cross-host downloads still exclude bypass
actors. See [role semantics](github-parity.md#ruleset-bypass-by-repository-role).


## Default branch from the CLI

CLI **0.4.9** provides `repo default-branch` and
`repo edit --default-branch BRANCH [--revision N]`. The read command returns the
current default, settings revision and existing branch heads. The edit reads
fresh state and performs one exact-head, revision-conditional selection. It
requires the separate current-admin `repository:default` permission, excluded
from ordinary login defaults and unavailable while archived. Existing protection,
ruleset and archive credentials gain no settings access.

Use `nh auth login -R owner/repo --scopes repository:default` to request only read
and default selection. The browser may reduce the request and checks current
membership again at exchange. The final writer also rechecks membership. The
setting changes clone HEAD and new-PR defaults while retaining refs, existing
PR targets, exact branch locks and other protections. A stale `--revision`, a
concurrent settings edit, or a moved branch head fails; an uncertain answer is
never retried automatically. Inspect `repo default-branch` before repeating it.

See [the contract](default-branch.md#native-cli-selection) and
[validation](evidence/cli-default-branch-validation.md).


## Successful execution required for checks

The existing 0.4.9 CLI supports the native `successOnlyChecks` protection field
through `rules get` / `rules set`. It is an explicit opt-in for the stricter Meld
migration gate: only `success` satisfies required pre-PR and merge checks;
neutral/skipped reports remain visible and block. Matching rules combine, so a
permissive exact rule cannot weaken a strict glob. The full export retains the
field; omission from an existing strict policy is rejected. Explicit `false`
uses the same admin grant and revision fence as other policy edits.

The receiver must advertise `successOnlyCheckConclusions: true` before accepting
the field. No credential gains new permissions, and no published CLI bytes
change. See [the contract](check-conclusions.md#success-only-migration-policy).

## Deployment environments

`nh env` and `nanohub env` manage the existing deployment environments through
native API calls. They require an explicit `environments:write` CLI permission
and the delegating account's **current repository admin or owner role** for
reads and writes. Ordinary login defaults and existing protection, ruleset,
review, merge and Git credentials gain no environment administration permission.
The browser consent screen describes the effect on reviewers, wait timers and
branch/tag source restrictions.

```sh
nh auth login -R owner/repository --scopes read,environments:write
nh env list -R owner/repository --json
nh env view ENVIRONMENT_ID -R owner/repository --json
nh env export ENVIRONMENT_ID -R owner/repository > environment.json
nh env update ENVIRONMENT_ID --file environment.json -R owner/repository
nh env delete ENVIRONMENT_ID --revision 12 --confirm ENVIRONMENT_ID -R owner/repository
```

To create an environment, use `env list` to get the current settings revision,
then prepare a UTF-8 JSON file and run `nh env create --file environment.json`:

```json
{
  "revision": 0,
  "configuration": {
    "name": "Staging",
    "reviewers": [],
    "preventSelfReview": false,
    "waitTimerMinutes": 0,
    "deploymentBranchPolicy": { "mode": "all" }
  }
}
```

Replace the revision with the actual observed value. `runner`, when present,
must identify an active registration in this repository. Reviewer IDs must have
current repository read access. Environment names are case-insensitive and
cannot be renamed to a different name; create a new environment and explicitly
update its requirements instead. Selected source rules distinguish branch and
tag patterns. `env export` includes all reviewer, self-review, timer and source
settings, including explicit empty/default values, so edits are complete
replacements. The stored per-environment revision and this **global settings
revision** are distinct.

Every CLI create, update and delete uses `If-Match: "environments-N"`. A browser
edit, another CLI writer, or a legacy SQL update/deletion invalidates an earlier
export through storage triggers. Concurrent writes using one revision cannot
both succeed. Identical no-op replacements leave the revision unchanged.
Unknown fields, expired/revoked credentials, demoted administrators, archived
repositories and unavailable current membership evidence fail closed. Old RPC
receivers return 503 rather than falling back to unconditional browser writes.
The final sequencer writer independently checks current admin membership,
reviewer eligibility, the settings revision and the archive fence in its
serialized transaction. Successful mutations retain account and CLI credential
provenance in repository activity.

The gateway exposes only `GET/POST .../environments`, `GET/PUT/DELETE
.../environments/:id` and `GET .../environments/:id/configuration` under this
scope. It grants no runner registration, secret-value access, deployment approval
or report submission. Existing credentials with this scope can inspect an
archived repository, but new environment write grants and mutations are blocked
while archived. Removing a required environment leaves its branch requirement
unmet; it does not waive that protection or reuse old deployment approvals.
An ambiguous mutation response is not retried automatically: inspect `env list`
or `env export` first.

## Import complete Git history

CLI **0.4.12** provides `repo import SOURCE -R owner/repository`. First create
an empty independent Git repository with a default branch present in the source.
Use a full mirror or a checkout containing all branches/tags you intend to import;
remote-tracking refs are not source branches. Shallow sources are refused.

```sh
nh auth login -R owner/repository --scopes read,contents:read,contents:write
nh repo import /absolute/path/to/source.git -R owner/repository --json
```

An ordinary repository Git token also works: save it with `auth login
--with-token` using stdin from your trusted secret manager, then run `repo
import SOURCE --git -R owner/repository`. Without `--git`, a stored content-scoped
CLI login is preferred; if none exists the selected OS Git helper is consulted.
An API credential missing content permission fails instead of falling back to
another identity. No agent, account-wide credential or browser session is used.

The source stays read-only, including uncommitted/untracked work and its remotes.
The command preserves committed object IDs/history, branches, tags, binaries,
executable modes and symlinks. It checks receiver support before bounded uploads,
publishes the checked ref set atomically, then makes an independent private mirror
clone, runs strict fsck and compares refs and branch trees/modes. Completion is
reported only after verification. LFS, submodules, issue/review metadata and
uncommitted work are outside this migration contract.

The destination must be empty or contain exactly the pinned source refs. An
identical destination is verification-only (`resumed: true`, `uploadedObjects: 0`).
Different existing refs are never overwritten. This permits recovery after a
lost final response or failed verification clone. Immutable batches retry up to
four attempts for transport/429/503 failures, honoring at most 60 seconds of
Retry-After per retry. Ref publication is never replayed automatically. Partial
unreferenced packs may remain until repository deletion.

Existing current role, scope, revocation, archive and ref policies apply. Git
tokens still cannot call application APIs. Verification disables redirects and
external credential helpers, scopes its transient HTTP header to the selected
Git URL, removes its temporary clone, and leaves global/helper configuration
unchanged. Imported commit authors remain unchanged; ref writes are attributed
to the credential owner. See [storage limits](standalone-host.md#migrate-committed-code).

## Runner registrations

CLI **0.4.11** adds these commands. The [release evidence](evidence/cli-runners-validation.md)
records isolated mutation acceptance and the read-only production rollout checks.

Runner administration requires the explicit **`runners:write`** permission and
current repository **owner** access. Repository admins cannot delegate it.
Ordinary login defaults and existing credentials gain no runner permission.
This is separate from the sandbox-scoped Codegraff account key: a Nanohub
registration authorizes this repository's checks and scoped Git read leases;
the account key authorizes allocation of Codegraff VMs.

```sh
nh auth login -R owner/repository --scopes read,runners:write
nh runner list -R owner/repository --json
nh runner create codegraff-actions --token-file ~/.config/nanohub/repository-runner.json -R owner/repository
nh runner recover --token-file ~/.config/nanohub/repository-runner.json -R owner/repository
nh runner revoke RUNNER_ID --confirm RUNNER_ID -R owner/repository
```

Create the private parent directory first. The CLI exclusively creates an
owner-readable file outside Git checkouts, saves its random 256-bit CI credential
and registration ID, and syncs it **before requesting registration**. Existing
files are never overwritten. stdout/JSON contains public registration metadata
and the file path, never the credential field. Keep the file on the trusted
controller; it is not a repository asset. The server stores only its SHA-256
hash and never returns the CLI-created credential.

If the response is lost, `runner recover` uses the same ID, name and credential
from disk. Identical recovery is idempotent and preserves trusted check-source
pins. Conflicting credentials/names and already-revoked IDs are rejected; delayed
requests cannot restore a revoked identity. Recovery accepts only a bounded,
owner-only regular file, refuses symlinks and binds the exact host and owner/repo
or trunk address stored in the file. Keep using an existing rename alias when
that is the address recorded in the file. CLI API errors redact CI credentials.
Old RPC receivers cannot fall back to the browser's unconditional issuer.

Issued CI credentials have an **independent lifetime**: they last until their
runner registration is revoked, including after the provisioning CLI credential
expires or is revoked. Browser consent states this. Revocation is owner-only,
is idempotent, invalidates active Git read leases and callbacks, and immediately
requeues running/waiting candidates for another registration. The old attempt
cannot report afterward. Existing grants can list and revoke while archived;
registration/recovery and new runner-management grants are blocked while
archived. Successful CLI registration/revocation records account and credential
provenance in repository activity without tokens or hashes.

The trusted dispatcher can read this file directly:

```json
{
  "origin": "https://nanohub.sh",
  "repository": "owner/repository",
  "backend": "codegraff",
  "runnerCredentialFile": "/absolute/private/repository-runner.json",
  "image": "registry.cloudflare.com/ACCOUNT/nanohub-ci@sha256:VERIFIED_DIGEST",
  "imageRegistry": { "provider": "cloudflare", "config": "/etc/nanohub/wrangler.jsonc" },
  "artifacts": "/var/lib/nanohub-ci/private-artifacts"
}
```

Set the existing sandbox-scoped `CODEGRAFF_API_KEY` only in the trusted
controller environment. No `NANOHUB_CI_TOKEN` export is needed for a file-backed
target. Pools may use a different absolute `runnerCredentialFile` per repository.
Every file is validated before any claim. Invalid, unreadable or mismatched
files never fall back to an ambient token. Explicit `tokenEnv` remains supported
as an alternative, but cannot be combined with a file for one target. Files are
loaded at pool startup; restart the controller when intentionally switching
registrations. Candidate bundles, mounts and environment receive neither file
nor control credential.
