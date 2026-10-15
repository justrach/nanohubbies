import { abuseLimits, checkSeed, clientKey, creationBody, limited } from "./abuse";
import type { User } from "./auth";
import { githubToken } from "./github/api";
import { importWithAccess } from "./github/import-access";
import { importGitHub, importGitHubContext, parseRepo } from "./importer";
import { importByteLimit } from "./import/job-state";
import { TEMPLATE_ISSUES, TEMPLATES } from "./templates";

/** Both entry points reserve capacity before any GitHub download, seed
 *  objects, or Artifacts repository is created. All deployed Workers share
 *  the Hub's durable, atomic quota check; localhost keeps its old workflow. */
export async function createTrunk(request: Request, env: Env, url: URL, trunk: string, user: User | null, importing: boolean): Promise<Response> {
  const limits = abuseLimits(env, url);
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const owner = user?.id ?? null;
  let ticket: string | null = null;
  if (limits) {
    const creator = await clientKey(request);
    const guard = env.HUB.get(env.HUB.idFromName(`rate:${creator}`));
    const rate = await guard.takeRate("creation", limits.creations, 3_600_000);
    if (!rate.ok) return limited("trunk creation rate limit reached", rate.retryAfter);
    const admitted = await hub.reserve(trunk, owner, creator, limits);
    if (!admitted.ok) {
      return Response.json({ error: admitted.error }, { status: admitted.status, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
    }
    ticket = admitted.ticket;
  }

  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const room = env.ROOM.get(env.ROOM.idFromName(trunk));
  let initializing = false;
  try {
    const body = await creationBody<{ files?: { path: string; text: string }[]; template?: string; repo?: string; background?: boolean; visibility?: "private" | "public" }>(request, limits?.bodyBytes ?? null);
    if (body.visibility !== undefined && !["private", "public"].includes(body.visibility))
      throw new Error("visibility must be private or public");
    // Authenticated repository imports can contain private code. Establish the
    // boundary before downloading or seeding anything, never after publishing.
    if (body.visibility === "private" || (importing && user)) {
      if (!user) throw new Error("sign in to create a private workspace");
      await hub.protectOwner(trunk, user.id, url.origin);
      await room.restrictTeam(trunk);
    }
    if (importing && body.background === true) {
      if (!user) throw new Error("sign in to copy a repository in the background");
      const upstream = parseRepo(body.repo ?? "");
      initializing = true; // A lost enqueue reply must not release its reservation.
      const job = await env.IMPORT_JOB.get(env.IMPORT_JOB.idFromName(trunk)).start({
        id: crypto.randomUUID(), trunk, upstream, origin: url.origin, owner: user.id,
        provider: user.provider, ticket, maxBytes: importByteLimit(env),
      });
      return Response.json({ background: true, job }, { status: 202 });
    }
    let source: string;
    let files: { path: string; text: string }[];
    let skipped = 0;
    let importedCommit: string | null = null;
    let upstream: { owner: string; repo: string; ref: string | null } | null = null;
    let token: string | null = null;
    if (importing) {
      upstream = parseRepo(body.repo ?? "");
      const { owner: repoOwner, repo, ref } = upstream;
      const result = await importWithAccess(
        user?.provider === "codegraff"
          ? () => env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).githubToken(url.origin, [`${repoOwner}/${repo}`], true)
          : null,
        githubToken(env),
        (credential) => importGitHub(repoOwner, repo, ref, credential, limits?.seedBytes),
      );
      token = result.token;
      const imported = result.imported;
      files = imported.files;
      skipped = imported.skipped;
      importedCommit = imported.commit;
      source = `github:${upstream.owner}/${upstream.repo}${importedCommit ? `@${importedCommit.slice(0, 12)}` : ""}`;
    } else {
      const template = body.template ? TEMPLATES[body.template] : undefined;
      if (body.template && !template) throw new Error(`no template named ${body.template}`);
      files = template ? Object.entries(template).map(([path, text]) => ({ path, text })) : (body.files ?? []);
      source = body.template ? `template:${body.template}` : "files";
    }
    checkSeed(files, limits);
    initializing = true;
    const head = await seq.init(trunk, files);
    const info = { name: trunk, created: Date.now(), source, owner };
    // Register immediately after init, before optional room/context work. A
    // failure importing issue metadata must not orphan a successfully seeded
    // trunk or release its quota while its objects still exist.
    if (ticket) await hub.complete(info, ticket);
    else await hub.add(info);
    if (upstream) {
      const context = await importGitHubContext(upstream.owner, upstream.repo, token);
      await room.importRepo({ ...context.repo, commit: importedCommit, contextUpdatedAt: Date.now(), contextNotes: context.notes, importSummary: { files: files.length, skipped, notes: context.notes, importedAt: Date.now() } }, context.issues);
      return Response.json({ ...head, files: files.length, skipped, issues: context.issues.length, pulls: context.repo.pulls.length, notes: context.notes, source });
    }
    for (const i of body.template ? (TEMPLATE_ISSUES[body.template] ?? []) : []) await room.openIssue(i.title, i.body, "template", i.labels);
    return Response.json(head);
  } catch (error) {
    // Before init, failure has no persistent seed and can release the slot.
    // Once init was dispatched, a lost reply can mean it *did* create objects:
    // keep its reservation rather than accidentally admitting more storage.
    if (ticket && !initializing) await hub.release(trunk, ticket);
    throw error;
  }
}
