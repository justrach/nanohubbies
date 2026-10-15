# Developing nanohub swarm

Layout, local development, the scripts and benchmarks, sign-in, Cloudflare Artifacts, imports, startup, design system, and public limits.

## Layout

A Turborepo with two packages:

- `packages/api`: the Worker's API and git routes, and every Durable Object
  (sequencer, packer, lanes, room, agents, drivers, hub, accounts), plus the
  scripts below.
- `apps/web`: the pages, a Next.js app built for Cloudflare with OpenNext.
  Its `worker.ts` is the one Worker that gets deployed: `/api/*` and `/git/*`
  go to `packages/api`, every other path to Next.js. The repository pages
  (code, files, history, diffs, pull requests) render on the server: they
  call the API in-process, with the Worker's bindings from
  `getCloudflareContext()` (`src/server/api.ts`). Repository reads authorize
  every request, then resolve versions before consulting `BROWSE_CACHE` in
  Workers KV. Trees, blobs, history and diffs use immutable revision keys;
  heads, permissions and room presence stay live. An 8 MiB isolate cache sits
  in front of KV; entries are limited to 1 MiB and expire after one day.
  KV failures or reads slower than 75 ms fall back to git objects. Writes use
  the request's `waitUntil`, and `X-Browse-Cache` reports `miss`, `kv`, or
  `memory`. Keep the KV binding in both Wrangler configurations. The live
  views (dashboard, issues, people) and pull request reader render in the
  browser. Commit rows avoid bulk prefetching; workspace head polling runs
  every 30 seconds in visible tabs, with live-event and focus refreshes.


## Run it

    npm install
    npm run dev            # the API on http://localhost:8787, the dashboard on http://localhost:3000

Open http://localhost:3000, create a trunk from the template or import a public
GitHub repository, and launch scripted agents from the trunk's page. They run
inside Durable Objects, not in the browser. `npm run preview` builds the
deployable Worker instead and serves all of it on http://localhost:8787.

Scripts, from `packages/api` with the dev server running:

    node scripts/demo-conflict.ts     # the rename-vs-new-caller conflict, in both landing orders, and the same changes with plain git
    node scripts/demo-team.ts         # three people, their agents and swarms on one trunk; REPO=owner/name imports a GitHub repository instead
    node scripts/smoke-concurrency.ts # 72 changes at once: appends to one file all land, edits to one function land once
    node scripts/smoke-lease.ts       # a slow agent against scripted agents rewriting its function: it loses twice, gets a lease, lands
    node scripts/swarm-run.ts         # scripted agents on a fresh trunk, rates read from the trunk, then clone the result and check it
    node scripts/bench.ts             # the same edits landed three ways: plain git, a merge queue, the sequencer
    node scripts/smoke-push.ts        # agents pushing with plain git and a token: lands, lands from behind, rename vs new caller refused
    node scripts/smoke-browse.ts      # the trunk read as a repository, and its patch applied with git am to a copy with no shared history
    STEP=<name> node scripts/climb.ts # one step of the hill climb: landings per second on one trunk, and the sequencer alone
    node scripts/runtimes.ts          # the sequencer's own code on Node and on Bun, outside Workers, as a yardstick (needs no dev server)

`demo-team.ts` signs in as alice, bob and carol with the development login and
keeps its trunk, so it can be watched in the dashboard while it runs.

`bench.ts` writes its results where the dashboard's home page shows them, and
so does `climb.ts`: each run is a labelled step, measured the same way, so the
home page charts the climb. It measures two things. End to end, agents land
changes through the API, each on its own file, so the sequencer is all they
share; in local development everything runs on one thread, so this is bound by
the total work per change. Then the sequencer alone lands changes back to
back with nothing in between (a development-only endpoint), and publishes
them: both run in the sequencer, so together they are the ceiling once the
rest runs in parallel. Local storage slows as it fills, so measure each step
against a dev server on a fresh store (`npx wrangler dev --persist-to
"$(mktemp -d)"`, then `SWARM_URL=` its address).

`runtimes.ts` runs the same landing and publishing code outside Workers, on
Node and on Bun (`BUN=` picks which), with stand-ins for the Durable Object's
SQLite and for R2. Neither can host a Durable Object; next to the sequencer's
rate in workerd, they show how much of a landing is the runtime's cost. That
comparison found the runtime's per-call costs that steps 7 and 8 of the climb
cut: one SQL statement per object, key and directory, and Buffer in the tree
and hex code.


## Sign-in

The homepage's Get started action opens `/dashboard`. Its GitHub and Codegraff
buttons use the same account flow; GitHub preselects that provider on Codegraff.
New and returning users both land on `/dashboard`, where they can create a
workspace. Repository setup follows sign-in. Run `npm run test:auth -w @swarm/api`
from `swarm/` to check both entry points and their callback destinations.

Sign in with Codegraff runs through Better Auth, with Codegraff as an OpenID
Connect provider and Better Auth's tables in a D1 database of the app's own
(`AUTH_DB`), made on first use. Set these in `packages/api/.dev.vars` locally
(`apps/web` links to the same file), or with `wrangler secret put` when
deployed:

    OIDC_ISSUER=https://codegraff.com          # the default
    OIDC_CLIENT_ID=…
    OIDC_CLIENT_SECRET=…
    BETTER_AUTH_SECRET=…                        # any long random string

The first sign-in makes the person's user row and later ones find it. The
provider's tokens are never stored in the tables: they live in each person's
Account object, which refreshes them one at a time. OAuth state lives in a
cookie, so an abandoned sign-in leaves no row behind. The redirect URI is
`<origin>/api/auth/callback/codegraff`.

With the `github:read` scope, people can import their own GitHub repositories,
private ones included; the app asks for a short-lived read-only token per
import and never stores it. Pull request pages use the same kind of token, kept
in memory until shortly before it expires. GitHub itself is connected on
Codegraff, never here, so one connection serves both. Without
`BETTER_AUTH_SECRET`, a development login appears on localhost, the app never
touches the database, and anyone can import public repositories.


## With Cloudflare Artifacts

Production must include the `ARTIFACTS` binding too: an R2 bucket alone does not
enable the Artifacts mirror. Set `artifacts: [{ binding: "ARTIFACTS", namespace:
"your-namespace" }]` in the deployment configuration. Newly created workspaces
then create an Artifacts repository and mirror their landed commits to it.
The workspace info API reports `mirror.pushed` for checking publication.

Artifacts bindings reach the real service even in local development, so this
mode needs a Cloudflare account with Artifacts. From `packages/api`:

    npx wrangler login
    npx wrangler dev --env artifacts

The scripts then also wait for each trunk's Artifacts repo to catch up, clone
it with plain git, and check that its HEAD is the trunk's HEAD. They delete the
trunks they make, Artifacts repos included, unless `KEEP=1` is set.


## Cloudflare CLIs

The workspaces use Wrangler 4.151.0. Cloudflare's separate `cf` CLI can be
installed with `npm install -g cf`; it has its own authentication, checked with
`cf auth whoami`. Installing it does not migrate this OpenNext deployment.


## Import boundaries

GitHub imports stream the tar archive (up to 2 GiB unpacked) instead of holding
it in memory. The workspace retains UTF-8 text files, at most 256 KiB each and
3,000 files; generated folders and binary assets are excluded. Local imports
have a 32 MiB retained-text budget. Hosted imports also respect the configured
`TRUNK_SEED_MAX_BYTES` admission budget (8 MiB by default). This is a source
snapshot, not a full Git mirror. Setup shows retained/excluded counts and any
incomplete GitHub context. Upstream history and issue comment threads are not
copied. Issue and PR metadata are bounded snapshots taken at import time.

Validate with `npm run test:import` in `swarm/packages/api`. For a real local
corpus, `node scripts/smoke-import.ts /path/to/repository` streams its HEAD
archive, seeds isolated Worker storage, clones it back, compares every retained
file and runs `git fsck`. It never modifies the source repository or a user's
existing workspace.


## Background GitHub imports

Signed-in onboarding sends `background: true` to the import endpoint. The workspace
is private and available for agent setup and room planning immediately.
`GET /api/trunks/:name/import` reports durable progress; cloning and code work become
available after the source snapshot is published. Closing the browser does not
cancel the job. Owner-only `POST /api/trunks/:name/import/retry` retries a failed
job, with bounded automatic and manual attempts.

`IMPORT_JOB` stages archive text in SQLite one file at a time and seeds the
sequencer in replayable batches. Its alarms resume work after worker restarts.
Authenticated background imports default to 64 MiB of retained source;
`TRUNK_IMPORT_MAX_BYTES` may configure up to 128 MiB. Existing per-file, file-count,
asset exclusion, and archive limits still apply. Public synchronous imports retain
the smaller admission budget. GitHub context merges after source publication and
preserves local tasks created while the copy runs.

Run `node scripts/smoke-background-import.ts` from `packages/api` for the isolated
12 MiB import, restart, lost-response replay, privacy, early setup, Git integrity,
context collision, and retry checks. Run `npm run test:import` for stream parsing.


## Workspace startup

`GET /api/trunks/:name/bootstrap` authorizes the workspace before returning its
head, import progress, repository metadata, signed-in session, and the caller's
token metadata (never token secrets). Responses are private and not cached.
Server components share this read only within the current React request, then
hydrate the workspace shell to avoid four redundant browser startup requests.
Live room updates and background progress polls keep the initial snapshot fresh.

The workspace sidebar persists across pages. Getting started opens a keyboard
accessible drawer with repository, agent connection, and first-change progress.
Navigation prefetch runs on intent instead of fetching every workspace page at
startup. `smoke-owner-workspace.ts` and `smoke-background-import.ts` cover bootstrap
privacy for owners, other users, anonymous callers, and agent tokens.


## Design system

The live component reference is `/design-system`. Shared light/dark tokens
live in `apps/web/src/design-system.css`, and `components/Brand.tsx` reuses
`public/favicon.svg` for the app mark. `components/ui.tsx` and `controls.tsx`
provide buttons, links, fields, panels, and status pills. Use these before
adding page-specific controls. Blue means action or selection; status colors
always need a text label. Keep the compact workspace layout, 4 px spacing
rhythm, 8 px controls, and 12 px panels. Geist is the UI face; Geist Mono is
for code, hashes, and commands. Preserve visible keyboard focus and reduced
motion behavior when extending components.


## Public deployment limits

Public hosts enforce durable trunk quotas and per-address request throttles.
See [public admission controls](public-abuse-controls.md) for defaults,
deployment variables, concurrency and recovery trade-offs, and local checks.
