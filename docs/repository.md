# A workspace, read like a repository

Code, history, diffs, branches and stacked pull requests, releases, the pull request reader, and the way work goes back to GitHub.

## A trunk, read like a repository

Each trunk has the pages a git host has, at the paths GitHub uses, so a link
reads the same way:

- **Code** (`/t/<trunk>`, `/tree/<dir>`, `/blob/<file>`): the newest version's
  files, the change it is, the directory's README, and, at the top, where the
  trunk came from and what its agents are doing now. Files are highlighted and
  every line is a link (`#L12`). `?v=12` pins any page to a version; a page
  says when newer versions have landed since it loaded, and `t` finds a file.
- **Commits** (`/commits`, `/commit/<version or sha>`): the history a page at a
  time, grouped by day, and each version's message, trailers and diff, drawn
  like a pull request: files in reading order, word-level highlights, `j`, `k`
  and `v` to work down them.
- **Branches** (`/branches`): create branches from main or another branch and
  browse their source. Git pushes to feature branches save work without landing.
- **Pull requests** (`/pulls`, `/pulls/<number>`): native reviews, incremental
  stacked diffs, dependency order, restacking, and merging. GitHub context and
  export instructions remain at `/pulls/upstream`.
- **Issues**, **Live** and **People**: the board, the live dashboard
  (throughput, how lives end, every agent, the change feed, the review queue,
  the channel), and what landed for whom.

Agents read the same things as JSON, at published versions:

| route | returns |
|---|---|
| `GET /api/trunks/:t/tree?v=&path=` | a directory: entries (folders first), its README, the version's change |
| `GET /api/trunks/:t/blob?v=&path=` · `/raw?v=&path=` | one file as JSON, or as plain text |
| `GET /api/trunks/:t/commits?from=&limit=` | the history, newest first, from version `from` down, and where the next page starts |
| `GET /api/trunks/:t/commit/:v` | one version (or commit sha): message, trailers, parent, and each file's diff |
| `GET /api/trunks/:t/compare?from=&to=` | every file that changed between two versions |
| `GET /api/trunks/:t/patch?from=&to=&format=mbox\|diff` | the same as one patch for `git am` (default) or `git apply` |
| `GET /api/trunks/:t/brief` | everything an agent needs to work on the trunk, as markdown |

All of it is read from the git objects in R2, so the sequencer only says which
commit a version is.


## Native branches and stacked PRs

Push `refs/heads/<branch>` to retain the exact Git commits for review. Main keeps
its existing direct-landing behavior. Feature refs are advertised for ordinary
Git fetch, clone, push, force-with-lease, and deletion. Branch updates compare the
observed old SHA; all objects must be stored before a ref becomes visible.

Open PRs with head and base branch names. `main ← schema ← api` is two PRs, with
the API PR based on `schema`. Its stored comparison anchor keeps the diff limited
to its own layer, even after the parent lands as a sequenced commit. A child
cannot merge before its parent. Merging a parent retargets direct children to
main and retains their stack history. Branches used by open PRs cannot be deleted.

| Route under `/api/trunks/:trunk` | Behavior |
| --- | --- |
| `GET /branches` or `/pulls` | Branches, PRs, and reviews |
| `POST /branches` `{name,from?}` | Create at main or another branch |
| `DELETE /branches` `{name,commit}` | Delete if the SHA still matches |
| `GET /branches/tree?name=&path=` | Read source on a branch |
| `POST /pulls` `{title,body?,head,base?}` | Open a PR; base defaults to main |
| `GET /pulls/:number` | Metadata, stack, current head, and incremental diff |
| `GET /pulls/:number/file?path=&side=head\|base` | Source at the PR revision |
| `POST /pulls/:number/reviews` | `{commit,anchor,verdict,body?}` |
| `POST /pulls/:number/restack` or `/merge` | `{commit,anchor}` from the reviewed revision |
| `POST /pulls/:number/close` | Close while retaining the final diff |

All routes use the existing workspace authorization boundary. Writes require a
session or scoped agent credential. Reviews bind to both the head and comparison
anchor; a current request-changes review blocks merging until superseded. Merge
and restack reject stale revisions. The sequencer atomically records the merge,
PR state, and child retargeting before publishing the new main version.

Restack creates one new commit for the layer on the latest base. It coalesces
identical edits and preserves disjoint file changes; competing edits return the
conflicting paths without moving a ref. Resolve those locally and push with
`--force-with-lease`. A local rebase onto the latest base updates the PR anchor.
Fetch after a server restack before continuing local work. Main retains its text
file model; links, submodules, and executable-mode changes cannot merge here.
Workspace limits are 200 branches, 500 PRs, and 2,000 reviews. No GitHub writes
or synchronization happen through these native routes.

Run `node scripts/smoke-stacks.ts` from `packages/api` against the local server.
It exercises real Git pushes, incremental diffs, parent updates, approvals,
merge ordering, concurrent requests, conflicts, local rebases, private access,
agent credentials, ref deletion, retained history, and `git fsck --strict`.
`node scripts/preview-stacks.ts` creates a local-only interactive browser fixture.


## Releases

A release tags a published version and carries files to download
(`/t/<trunk>/releases`). Only the signed-in workspace owner drafts one, attaches
files to a draft, publishes, unpublishes, or deletes it; agent credentials
cannot. Anyone can list published releases and download their files, even from
a private workspace, and the page says so before the owner publishes. Files are
kept in R2 under `release-assets/`, apart from git objects.

| Route | Behavior |
| --- | --- |
| `GET /api/trunks/:trunk/releases` | Every release for the owner; published ones, without source details, for others |
| `POST /api/trunks/:trunk/releases` `{tag,title,notes,version}` | Draft at a published version; tags are unique |
| `POST …/releases/:id/assets?name=` | Attach the request body as a file (draft only, `Content-Length` required) |
| `POST …/releases/:id/publish` or `/unpublish` · `DELETE …/releases/:id` | Publish, return to draft, or delete with its files |
| `GET /api/public-releases/:trunk[/:id/:asset]` | Published releases, and one file's download |

Each file is at most 250 MB, a release has at most 20, a workspace at most 100
releases and `RELEASE_MAX_BYTES` (1 GiB) of files. Deleting a workspace deletes
its releases and files, so a later workspace of the same name starts with none.
Run `node scripts/smoke-releases.ts` from `packages/api`; it needs no server.


## Reading pull requests

Any public GitHub pull request opens at `/pr/<owner>/<repo>/<number>`, or by
pasting its URL on the home page, laid out to be read rather than scrolled:

- **Overview**: the description, then reviews, comments and pushes in order,
  beside the checks, the reviewers, and how many lines change in each folder.
- **Files**: grouped in reading order (docs, entry points, source, tests,
  build and CI, then generated files folded away), or as folders. Diffs are
  highlighted, mark the words that changed inside an edited line, wrap long
  lines, and say how many unchanged lines each gap hides and in which
  function. A new file reads like plain code, a new markdown file renders, and
  a long file has an outline to jump around in. Review threads sit under the
  line they are about, with suggested changes drawn as diffs. Files can be
  marked viewed, and `j`, `k` and `v` move through them.

The Worker reads GitHub's REST API, keeps each answer for a minute, then
revalidates it with its ETag. Signed in with Codegraff, with GitHub connected
there, a page is read with that connection, under its own rate limit of at
least 5,000 requests an hour, and an unchanged answer is not counted. The
page says which way it was read. Without GitHub connected, the page and the
top bar link to Codegraff to connect it; a connection made there works here
too, and the page reads itself again when you come back. A public repository
that connection does not reach is read the shared way instead.

The shared way is anonymous: 60 requests an hour per server address, about
eight pull requests, with every revalidation counted. A deployment can set
`GITHUB_TOKEN` to raise that to 5,000. A fine-grained token with read-only
access to public repositories and no other permissions is enough. Do not give
it access to private repositories: anyone who can open the dashboard can read
any pull request through it.


## GitHub keeps the original

The trunk is the fast layer between GitHub and the agents. It starts from a
GitHub repository and its work goes back there:

- **In**: paste a repository on the front page, or swap `github.com` for this
  host in any repository's address (`/<owner>/<repo>`, and `/tree/…`,
  `/blob/…`, `/issues/…` under it). A repository with a trunk opens it; one
  without offers to make one. A pull request's address opens it on the
  reading page.
- **Out**: Pull requests → GitHub context and export gives the lines that send everything that
  landed back as one pull request, from any clone of the original:

      git switch -c swarm/<trunk> <the commit it was imported from>
      curl -fsSL <host>/api/trunks/<trunk>/patch | git am --keep-cr
      git push -u origin swarm/<trunk>
      gh pr create --fill

  The patch is one commit by "nanohub swarm" that lists the newest changes and
  names the trunk and its versions. Blobs keep their git ids, so the patch
  carries the original's object ids and `git am -3` can fall back to a
  three-way merge on a newer branch. Practice agents' scratch files
  (`src/swarm/`) and the comments they leave on shared functions land like
  anything else, so the page says when they are in the patch. A trunk made
  here goes to GitHub whole: clone it and `gh repo create --source . --push`.
