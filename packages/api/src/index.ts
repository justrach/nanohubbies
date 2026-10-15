import { workspaceBootstrap } from "./workspace/bootstrap";
import { SeedTooLarge, throttle } from "./abuse";
import { currentUser, devUser, sessionCookie, settings, signOutCookie } from "./auth";
import { codegraffAuth, codegraffReady, sessionUser } from "./better-auth";
import { brief } from "./brief";
import { BROWSE, browse } from "./browse/routes";
import { createTrunk } from "./creation";
import { objectKey } from "./git";
import { GitHubError } from "./github/api";
import { refreshGitHubContext } from "./import/refresh";
import { readPull } from "./github/pulls";
import { readersFor } from "./github/reader";
import { parseRepo } from "./importer";
import { packKey } from "./packfile";
import { receivePack } from "./push";
import { advertise } from "./receive";
import { reviewRoute } from "./review/routes";
import { commentRoute } from "./review/comment-route";
import { releaseRoute, publicReleases } from "./releases/routes";
import { coordination } from "./room/routes";
import { requireTeam, privateResponse, visibleTrunks } from "./team/access";
import { TeamError } from "./team/provider";
import { teamRoute, discoverTeams } from "./team/routes";
import { listTokens, makeToken, pusher, revokeToken } from "./tokens";
import { AGENT_ROUTES, agentHelp, serve } from "./workflow";
import type { Owner } from "./types";

export { Account } from "./account";
export { Agent } from "./agent";
export { Driver } from "./driver";
export { Hub } from "./hub";
export { ImportJob } from "./import-job";
export { Lane } from "./lane";
export { Packer } from "./packer";
export { Room } from "./room";
export { Sequencer } from "./sequencer";

const TRUNK = /^[a-z0-9][a-z0-9-]{0,62}$/;
const AGENT = /^[A-Za-z0-9][\w.-]{0,63}$/;
const GH_NAME = /^[\w.-]{1,100}$/;

export default {
  async fetch(request, env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      const blocked = await throttle(request, env, url);
      if (blocked) return blocked;
      const git = url.pathname.match(/^\/git\/([^/]+)\.git\/(.+)$/);
      if (git) return await serveGit(request, env, checked(git[1], TRUNK, "trunk"), git[2], url);
      if (url.pathname.startsWith("/api/")) return privateResponse(await api(request, env, url, ctx));
      // Running alone in development, the pages are elsewhere: send people there.
      const app = (env as Env & { APP_ORIGIN?: string }).APP_ORIGIN;
      if (app && request.method === "GET") return Response.redirect(`${app}${url.pathname}${url.search}`, 302);
      return json({ error: "not found" }, 404);
    } catch (e) {
      if (e instanceof TeamError) return json({ error: e.message, code: e.code }, e.status, { "Cache-Control": "private, no-store", ...(e.status === 401 ? { "WWW-Authenticate": 'Basic realm="nanohub team"' } : {}) });
      return json({ error: e instanceof Error ? e.message : String(e) }, e instanceof SeedTooLarge ? 413 : 400);
    }
  },
} satisfies ExportedHandler<Env>;

//   GET    /api/auth/me                          who is signed in, and how one can sign in
//   GET    /api/auth/signin/codegraff            sign in, then open /dashboard
//   GET    /api/auth/signin/github               choose GitHub on the same account flow
//   GET    /api/auth/callback/codegraff          where Codegraff sends people back
//   POST   /api/auth/dev                         {name}: development login (local, no provider)
//   POST   /api/auth/signout
//   GET    /api/tokens · POST {label, trunk?}    your agents' push tokens · make one (shown once)
//   DELETE /api/tokens/:id                       revoke one
//   GET    /api/github/connection                whether GitHub is connected to your Codegraff account, or where to connect it
//   GET    /api/github/repos                     GitHub repositories connected to Codegraff
//   GET    /api/github/pulls/:owner/:repo/:n     a pull request: files and diffs, review threads, activity, checks
//   GET    /api/github/trunks?repo=owner/name    trunks imported from that repository, newest first
//   GET    /api/trunks                           every trunk
//   POST   /api/trunks/:t                        {files: [{path, text}]} or {template}: create a trunk
//   POST   /api/trunks/:t/import                 {repo: "owner/name#ref"}: create a trunk from GitHub, with its issues and pull requests
//   GET    /api/trunks/:t                        published head
//   DELETE /api/trunks/:t                        delete it, with its room and Artifacts repo (its maker only, outside local development)
//   GET    /api/trunks/:t/info                   heads and the Artifacts mirror
//   GET    /api/trunks/:t/repo                   the GitHub repository it was imported from, or null
//   GET    /api/trunks/:t/log                    recent submissions
//   GET    /api/trunks/:t/files · /file?path=    browse the tip
//   GET    /api/trunks/:t/tree · blob · raw · commits · commit/:v · compare · patch
//                                                browse published versions, as a git host does (./browse/routes)
//   GET    /api/trunks/:t/brief                  what an agent needs to work here, as markdown
//   POST   /api/trunks/:t/clone-token            read token for the Artifacts mirror
//   GET    /api/trunks/:t/room                   snapshot: agents, tallies, recent events
//   GET    /api/trunks/:t/live                   websocket: the snapshot, then live frames
//   GET    /api/trunks/:t/issues                 the trunk's issues · POST {title, body} opens one
//   GET    /api/trunks/:t/issues/:n              one issue and the changes that worked on it
//   GET    /api/trunks/:t/agenda                 open issues, least crowded first
//   POST   /api/trunks/:t/presence               "I am watching", for scripts (browsers hold the live socket)
//   GET    /api/trunks/:t/channel?after=&for=    channel messages (for=agent: only delivered ones)
//   POST   /api/trunks/:t/channel                {from, body}
//   GET    /api/trunks/:t/releases               releases; the owner drafts, attaches, publishes, deletes (./releases/routes)
//   GET    /api/public-releases/:t[/:r/:file]    published releases and their files, for anyone
//   POST   /api/trunks/:t/swarm                  {agents, seconds, shared, skew, think}: start your scripted agents
//   DELETE /api/trunks/:t/swarm?all=             stop yours, or everyone's
//   GET    /api/agent-help                       the agent routes below, as JSON, from the table that serves them
//   *      /api/trunks/:t/agents/:a/...          an agent's workflow (./workflow): lives, ls, file, symbol, refs,
//                                                submit, retry, submission, hold, status
async function api(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const [, , kind, rawTrunk, action, rawAgent, agentAction] = url.pathname.split("/");
  const q = (name: string) => url.searchParams.get(name) ?? "";
  const method = request.method;
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const auth = settings(env, url);
  const user = request.headers.has("authorization") ? null : (await sessionUser(env, request, url)) ?? (await currentUser(request, auth));

  if (kind === "auth") {
    const route = [rawTrunk, action].filter(Boolean).join("/");
    const codegraff = codegraffReady(env, url);
    if (route === "me") return json({ user, providers: { codegraff, dev: auth.dev } });
    if (route === "signin/codegraff" || route === "signin/github") {
      if (!codegraff) throw new Error("Sign in with Codegraff is not configured here");
      // Better Auth answers with where to go and sets its state cookie; a
      // browser following a link wants the redirect itself. Failures come back
      // to the dashboard as ?error=<code>.
      const res = await (await codegraffAuth(env, url.origin, true, q("teams") === "1")).api.signInSocial({
        body: {
          provider: "codegraff", callbackURL: "/dashboard", newUserCallbackURL: "/dashboard", errorCallbackURL: "/dashboard",
          additionalParams: route === "signin/github" ? { login_provider: "github" } : undefined,
        },
        headers: request.headers,
        asResponse: true,
      });
      const { url: to } = await res.clone().json<{ url?: string }>();
      if (!to) throw new Error("Sign in with Codegraff could not start");
      const headers = new Headers({ Location: to });
      for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
      return new Response(null, { status: 302, headers });
    }
    // Where Codegraff sends people back: Better Auth checks the state, trades
    // the code, signs them in, and redirects to the dashboard.
    if (route === "callback/codegraff" && codegraff) return (await codegraffAuth(env, url.origin)).handler(request);
    if (route === "dev" && method === "POST") {
      if (!auth.dev) throw new Error("the development login is off here");
      const { name } = await request.json<{ name?: string }>();
      const dev = devUser(name ?? "");
      return json({ user: dev }, 200, { "Set-Cookie": await sessionCookie(dev, auth, url) });
    }
    if (route === "signout" && method === "POST") {
      const headers = new Headers({ "Set-Cookie": signOutCookie(url) });
      if (user?.provider === "codegraff") {
        await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).forget();
        const res = await (await codegraffAuth(env, url.origin, false)).api.signOut({ headers: request.headers, asResponse: true });
        for (const c of res.headers.getSetCookie()) headers.append("Set-Cookie", c);
      }
      return Response.json({ ok: true }, { headers });
    }
    return json({ error: "not found" }, 404);
  }
  if (kind === "teams" && method === "GET") return discoverTeams(env, request, user);
  if (kind === "tokens") {
    // Push tokens for your agents: make, list, revoke. Signed-in people only.
    if (!user) throw new Error("sign in to make push tokens for your agents");
    const owner = { id: user.id, name: user.name };
    if (!rawTrunk && method === "GET") return json(await listTokens(env, owner));
    if (!rawTrunk && method === "POST") {
      const body = await request.json<{ label?: string; trunk?: string | null }>();
      const trunk = body.trunk ? checked(body.trunk, TRUNK, "trunk") : null;
      return json(await makeToken(env, owner, String(body.label ?? ""), trunk));
    }
    if (rawTrunk && method === "DELETE") return json({ revoked: await revokeToken(env, owner, rawTrunk) });
    return json({ error: "not found" }, 404);
  }
  if (kind === "github" && rawTrunk === "connection") {
    // Whether there is a token, never the token: it stays on the server.
    if (user?.provider !== "codegraff") return json({ connected: false });
    const got = await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).githubReader(url.origin);
    if ("token" in got) return json({ connected: true, login: got.login });
    return json({ connected: false, ...("connect" in got ? { connect: got.connect } : { problem: got.error }) });
  }
  if (kind === "github" && rawTrunk === "repos") {
    if (user?.provider !== "codegraff") throw new Error("sign in with Codegraff to list your GitHub repositories");
    return json(await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).githubRepos(url.origin));
  }
  if (kind === "github" && rawTrunk === "pulls") {
    const owner = checked(action ?? "", GH_NAME, "owner");
    const repo = checked(rawAgent ?? "", GH_NAME, "repository");
    const number = Number(checked(agentAction ?? "", /^\d{1,9}$/, "pull request number"));
    const readers = await readersFor(env, user, url.origin, `${owner}/${repo}`);
    for (const [i, { reader, access }] of readers.entries()) {
      try {
        return json({ ...(await readPull(owner, repo, number, reader)), access });
      } catch (e) {
        if (!(e instanceof GitHubError)) throw e;
        // Refused with the person's connection: try the next way.
        if (i + 1 < readers.length && (e.status === 403 || e.status === 404)) continue;
        return json({ error: e.message, access }, e.status);
      }
    }
  }

  if (kind === "github" && rawTrunk === "trunks") {
    const { owner, repo } = parseRepo(q("repo"));
    const source = `github:${owner}/${repo}`.toLowerCase();
    return json((await visibleTrunks(env, request, await hub.list(), user)).filter((t) => t.source.toLowerCase() === source || t.source.toLowerCase().startsWith(`${source}@`)));
  }

  if (kind === "public-releases" && rawTrunk) return publicReleases(env, request, checked(rawTrunk, TRUNK, "trunk"), action, rawAgent);
  if (kind === "agent-help") return json(agentHelp(env, url.origin));
  if (kind !== "trunks") return json({ error: "not found" }, 404);
  if (!rawTrunk) return json(await visibleTrunks(env, request, await hub.list(), user));

  const trunk = checked(rawTrunk, TRUNK, "trunk");
  const teamAccess = await requireTeam(env, request, trunk, user);
  if (action === "releases") return releaseRoute(env, request, trunk, rawAgent, agentAction, user, teamAccess);
  if (action === "team") return teamRoute(env, request, trunk, user, teamAccess);
  if (teamAccess && action?.startsWith("benchmark")) return json({ error: "Benchmarks cannot impersonate agents in a team workspace" }, 403);
  if (teamAccess && method === "POST" && (!action || action === "import") && (teamAccess.proof.role !== "owner" || !!teamAccess.proof.agentId)) return json({ error: "Only a team owner can initialize this workspace" }, 403);
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const room = env.ROOM.get(env.ROOM.idFromName(trunk));
  // Who is asking, as the room and agents record it. Without sign-in, a guest.
  const me: Owner = user ? { id: user.id, name: user.name } : { id: "guest", name: "guest" };

  if (action === "branches" || action === "pulls") return reviewRoute(env, request, trunk, action, rawAgent, agentAction, user);

  if (!action) {
    if (method === "POST") return createTrunk(request, env, url, trunk, user, false);
    if (method === "GET") return json(await seq.head());
    if (method === "DELETE") {
      // The person who made it, signed in; anyone in local development.
      const made = await hub.find(trunk);
      if (teamAccess ? teamAccess.proof.role !== "owner" || !!teamAccess.proof.agentId : !auth.dev && (!user || !made?.owner || made.owner !== user.id)) return json({ error: "only the person who made a trunk can delete it" }, 403);
      const importJob = env.IMPORT_JOB?.get(env.IMPORT_JOB.idFromName(trunk));
      const importing = await importJob?.status();
      if (importing && !["complete", "failed"].includes(importing.phase)) return json({ error: "the import is still running; wait for it to finish before deleting the workspace" }, 409);
      await room.stopSwarm(trunk, null);
      const deleted = await seq.destroy().catch((error) => {
        if (importing && !importing.ready && /no such trunk/.test(String(error))) return { deleted: trunk };
        throw error;
      });
      await importJob?.forget();
      await room.reset();
      const releaseFiles = await hub.remove(trunk);
      for (let i = 0; i < releaseFiles.length; i += 1000) await env.OBJECTS.delete(releaseFiles.slice(i, i + 1000));
      return json(deleted);
    }
  }
  if (action === "bootstrap" && method === "GET") return workspaceBootstrap(env, trunk, user, { codegraff: codegraffReady(env, url), dev: auth.dev });
  if (action === "workspace" && method === "GET") {
    const entry = await hub.find(trunk);
    return entry ? json(entry) : json({ error: "no such workspace" }, 404);
  }
  if (action === "import" && method === "GET") {
    return json({ job: env.IMPORT_JOB ? await env.IMPORT_JOB.get(env.IMPORT_JOB.idFromName(trunk)).status() : null });
  }
  if (action === "import" && rawAgent === "retry" && method === "POST") {
    if (!user) return json({ error: "sign in to retry your import" }, 401);
    const entry = await hub.find(trunk);
    if (entry?.owner !== user.id) return json({ error: "only the workspace owner can retry this import" }, 403);
    return json({ job: await env.IMPORT_JOB.get(env.IMPORT_JOB.idFromName(trunk)).retry(user.id) });
  }
  if (action === "import" && method === "POST") return createTrunk(request, env, url, trunk, user, true);
  if (action === "commit" && agentAction === "comments") return commentRoute(env, request, trunk, rawAgent, user);
  if (BROWSE.has(action)) return browse(env, trunk, action, rawAgent, url, ctx);
  if (action === "brief") {
    const [head, repo, agenda] = await Promise.all([seq.head(), room.repo(), room.agenda(20)]);
    return new Response(brief({ trunk, origin: url.origin, head, repo, agenda, team: !!teamAccess, ownerOnly: teamAccess?.binding.kind === "owner" }), { headers: { "content-type": "text/markdown; charset=utf-8" } });
  }
  if (action === "info") {
    try { return json(await seq.info()); }
    catch (error) {
      const job = env.IMPORT_JOB ? await env.IMPORT_JOB.get(env.IMPORT_JOB.idFromName(trunk)).status() : null;
      if (job && !job.ready) return json({ error: "Source files are still being copied. The agent room is available.", code: "import_in_progress" }, 409);
      throw error;
    }
  }
  if (action === "github-context") return refreshGitHubContext(env, request, trunk, user);
  if (action === "repo") return json(await room.repo());
  if (action === "log") return json(await seq.log(Number(q("limit")) || 50));
  if (action === "files") return json(await seq.files());
  if (action === "file") return json(await seq.read(q("path")));
  if (action === "clone-token" && method === "POST") {
    if (teamAccess) return json({ error: "Use the authenticated workspace git endpoint for team repositories" }, 403);
    return json(await seq.cloneToken());
  }
  if (action === "benchmark" && method === "POST") {
    // How fast the sequencer alone decides; local development only.
    if (!auth.dev) throw new Error("the sequencer benchmark only runs in local development");
    const n = Math.min(20_000, Math.max(1, Number(q("n")) || 1000));
    const t0 = Date.now();
    const bots = Math.min(10_000, Math.max(1, Number(q("bots")) || 1000));
    const batch = Math.min(500, Math.max(1, Number(q("batch")) || 1));
    const landed = await seq.benchmark(n, Date.now().toString(36), q("apart") === "1", q("shape") === "swarm" ? "swarm" : "files", bots, batch);
    return json({ landed, ms: Date.now() - t0 });
  }
  if (action === "where") {
    // Which data centers the Worker and the trunk's sequencer run in.
    if (!auth.dev) throw new Error("only in local development and test copies");
    return json({ worker: (request as Request & { cf?: { colo?: string } }).cf?.colo ?? null, sequencer: await seq.colo() });
  }
  if (action === "benchmark-ops" && method === "POST") {
    if (!auth.dev) throw new Error("the sequencer benchmark only runs in local development");
    const n = Math.min(100_000, Math.max(1, Number(q("n")) || 1000));
    const t0 = Date.now();
    await seq.repeat(q("op"), n);
    return json({ op: q("op"), n, ms: Date.now() - t0 });
  }
  if (action === "benchmark-calls" && method === "POST") {
    // How many trivial calls a second the sequencer answers: the cost of a
    // call itself, apart from any work. Local development and test copies only.
    if (!auth.dev) throw new Error("the sequencer benchmark only runs in local development");
    const n = Math.min(5000, Math.max(1, Number(q("n")) || 1000));
    const c = Math.min(500, Math.max(1, Number(q("c")) || 50));
    let sent = 0;
    const t0 = Date.now();
    await Promise.all(Array.from({ length: c }, async () => {
      while (sent < n) {
        sent++;
        await seq.head();
      }
    }));
    return json({ calls: n, ms: Date.now() - t0 });
  }
  if (action === "room") return json(await room.snapshot());
  if (action === "live") {
    // The room learns who is watching from this header; it is set here, from
    // the session cookie, never by the browser.
    const upgrade = new Request(request);
    if (teamAccess?.proof.agentId) return json({ error: "Agents use the authenticated HTTP inbox and channel; the live socket is for signed-in people" }, 403);
    upgrade.headers.set("X-Swarm-User", JSON.stringify(user ? me : null));
    upgrade.headers.set("X-Swarm-Trunk", trunk);
    upgrade.headers.delete("X-Swarm-Team");
    if (teamAccess) upgrade.headers.set("X-Swarm-Team", JSON.stringify({ trunk, origin: url.origin, ownerId: teamAccess.proof.ownerId }));
    return room.fetch(upgrade);
  }
  if (action === "presence" && method === "POST") return json(await room.heartbeat(me));
  if (action === "issues") {
    const number = rawAgent ? Number(rawAgent) : null;
    if (number !== null) {
      const found = await room.issue(number);
      return found ? json(found) : json({ error: `no issue #${number}` }, 404);
    }
    if (method === "POST") {
      const { title, body } = await request.json<{ title?: string; body?: string }>();
      return json(await room.openIssue(title ?? "", body ?? "", me.name));
    }
    return json(await room.issues());
  }
  if (action === "agenda") return json(await room.agenda(Number(q("limit")) || 50));
  if (action === "channel") {
    const credential = await pusher(env, request, trunk);
    if (request.headers.has("authorization") && !credential) return json({ error: "invalid or expired agent credentials" }, 401);
    if (method === "POST") {
      const { from, body, replyTo, handoffTo } = await request.json<{ from?: string; body?: string; replyTo?: number; handoffTo?: string }>();
      if (!user && !credential?.agentId && from === "sequencer") return json({ error: "sequencer is a system sender" }, 403);
      const sender = credential?.agentId ? credential.agent! : user ? `person:${user.name}` : checked(from ?? "", AGENT, "sender");
      if (credential?.agentId && from !== undefined && from !== sender) return json({ error: "the credential binds the sender; from cannot change it" }, 403);
      if (!await room.agentAllowed(sender, credential?.agentId)) return json({ error: "this sender is reserved; use its scoped agent credential" }, 403);
      return json(await room.post(sender, body ?? "", { replyTo, handoffTo }));
    }
    if (credential?.agentId && q("for") && q("for") !== credential.agent) return json({ error: "use your own agent inbox" }, 403);
    return json(await room.messages(Number(q("after")) || 0, q("for") || null));
  }
  if (action === "swarm") {
    if (teamAccess) return json({ error: "Team workspaces require verified agent credentials; practice agents are disabled" }, 403);
    if (method === "DELETE") return json(await room.stopSwarm(trunk, q("all") ? null : me.id));
    if (method === "POST") {
      const body = await request.json<{ agents?: number; seconds?: number; shared?: number; skew?: number; think?: [number, number] }>();
      const think: [number, number] = body.think ?? [1000, 4000];
      // A public deployment caps practice swarms (SWARM_MAX_AGENTS, SWARM_MAX_SECONDS).
      const caps = env as Env & { SWARM_MAX_AGENTS?: string; SWARM_MAX_SECONDS?: string };
      return json(
        await room.startSwarm(trunk, me, {
          agents: Math.min(body.agents ?? 100, Number(caps.SWARM_MAX_AGENTS) || 20_000),
          seconds: Math.min(body.seconds ?? 60, Number(caps.SWARM_MAX_SECONDS) || 3600),
          shared: Math.min(1, Math.max(0, body.shared ?? 0.15)),
          skew: Math.min(3, Math.max(0, body.skew ?? 1.1)),
          think: [Math.max(50, think[0]), Math.max(Math.max(50, think[0]), think[1])],
        }),
      );
    }
  }
  if (action === "agents") {
    const credential = await pusher(env, request, trunk);
    if (request.headers.has("authorization") && !credential) return json({ error: "invalid or expired agent credentials" }, 401);
    const name = rawAgent ? checked(rawAgent, AGENT, "agent") : undefined;
    const coordinated = await coordination({ request, env, room, trunk, name, action: agentAction, user: user ? me : null, credential });
    if (coordinated) return coordinated;
    if (!name) return json({ error: "not found" }, 404);
    // An agent's workflow: one table for routing and for /api/agent-help (./workflow).
    const registered = await room.registeredAgent(name);
    const ownerInspect = method === "GET" && !agentAction && !credential?.agentId && !!user && !!registered && registered.owner.id === user.id;
    if (teamAccess && !credential?.agentId && !ownerInspect) return json({ error: "Team work requires a registered agent credential" }, 403);
    if (!ownerInspect && (!await room.agentAllowed(name, credential?.agentId) || credential?.agentId && credential.agent !== name)) return json({ error: "this handle is reserved; use its scoped agent credential" }, 403);
    const route = AGENT_ROUTES.find((r) => r.method === method && r.action === (agentAction ?? ""));
    const agent = env.AGENT.get(env.AGENT.idFromName(`${trunk}/${name}`));
    if (route) return serve(route, { request, q, trunk, name, me: credential?.owner ?? (user ? me : null), agent, seq, room });
  }
  return json({ error: "not found" }, 404);
}

/** Clones and fetches use git's dumb HTTP protocol: the refs, then packs (and,
 *  for trunks from before packs, loose objects) straight from R2. Every pack
 *  and object URL is immutable, so a CDN can cache it forever. Pushes use the
 *  smart protocol (./push), and land. */
async function serveGit(request: Request, env: Env, trunk: string, path: string, url: URL): Promise<Response> {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const teamAccess = await requireTeam(env, request, trunk);
  const protect = (response: Response) => teamAccess ? privateResponse(response) : response;
  const pushing = path === "git-receive-pack" || (path === "info/refs" && url.searchParams.get("service") === "git-receive-pack");
  if (pushing) {
    // A push needs an agent's credential from the trunk's page. Git answers
    // this challenge with the URL's handle and its credential helper's token.
    const who = await pusher(env, request, trunk);
    if (!who) return new Response(`a push needs your agent's credential: ${url.origin}/api/trunks/${trunk}/brief shows how to give git its token\n`, { status: 401, headers: { "WWW-Authenticate": 'Basic realm="nanohub swarm"' } });
    return protect(path === "git-receive-pack" ? await receivePack(env, trunk, request, who) : advertise(await seq.haves(), await seq.refs()));
  }
  if (path === "info/refs") return protect(plain(await seq.refs()));
  if (path === "HEAD") return protect(plain("ref: refs/heads/main\n"));
  // No alternates, said as an empty list rather than a 404: git gives up on a
  // failed response mid-stream, and some clients' HTTP/2 lose their place.
  if (path === "objects/info/alternates" || path === "objects/info/http-alternates") return plain("");
  if (path === "objects/info/packs") {
    const { packs } = await env.PACKER.get(env.PACKER.idFromName(trunk)).list();
    return protect(plain(`${packs.map((p) => `P pack-${p.name}.pack\n`).join("")}\n`));
  }
  const packed = path.match(/^objects\/pack\/pack-([0-9a-f]{40})\.(pack|idx)$/);
  const loose = path.match(/^objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/);
  const found = packed
    ? await immutable(env, request, packKey(trunk, packed[1], packed[2] as "pack" | "idx"), packed[2] === "pack" ? "application/x-git-packed-objects" : "application/x-git-packed-objects-toc")
    : loose
      ? await immutable(env, request, objectKey(trunk, loose[1] + loose[2]), "application/x-git-loose-object")
      : null;
  return protect(found ?? plain("not found\n", 404));
}

/** An R2 object that never changes, with byte ranges: git resumes a pack
 *  download that broke off by asking for the rest. */
async function immutable(env: Env, request: Request, key: string, type: string): Promise<Response | null> {
  const ranged = request.headers.has("range");
  const obj = await env.OBJECTS.get(key, ranged ? { range: request.headers } : {});
  if (!obj) return null;
  const headers = new Headers({ "content-type": type, "cache-control": "public, max-age=31536000, immutable", "accept-ranges": "bytes" });
  const range = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (!ranged || !range) return new Response(obj.body, { headers });
  const start = range.suffix !== undefined ? obj.size - range.suffix : (range.offset ?? 0);
  const length = range.suffix ?? range.length ?? obj.size - start;
  headers.set("content-range", `bytes ${start}-${start + length - 1}/${obj.size}`);
  return new Response(obj.body, { status: 206, headers });
}

function checked(value: string, pattern: RegExp, what: string): string {
  if (!pattern.test(value)) throw new Error(`bad ${what} name: ${value}`);
  return value;
}

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return Response.json(body, { status, headers });
}

function plain(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
