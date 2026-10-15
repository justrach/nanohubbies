import type { User } from "../auth";
import { importGitHubContext, parseRepo } from "../importer";

export async function refreshGitHubContext(
  env: Env,
  request: Request,
  trunk: string,
  user: User | null,
) {
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const entry = await hub.find(trunk);
  const canRefresh =
    !!user &&
    user.provider === "codegraff" &&
    entry?.owner === user.id &&
    !request.headers.has("authorization");
  if (request.method === "GET") return Response.json({ canRefresh });
  if (request.method !== "POST")
    return Response.json({ error: "method not allowed" }, { status: 405 });
  if (!canRefresh)
    return Response.json(
      {
        error: "Only the signed-in workspace owner can refresh GitHub context",
      },
      { status: 403 },
    );
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin)
    return Response.json(
      { error: "Same-origin request required" },
      { status: 403 },
    );
  const room = env.ROOM.get(env.ROOM.idFromName(trunk));
  const previous = await room.repo();
  if (!previous)
    return Response.json(
      { error: "This workspace was not imported from GitHub" },
      { status: 400 },
    );
  const { owner, repo } = parseRepo(previous.fullName);
  const token = await env.ACCOUNT.get(
    env.ACCOUNT.idFromName(user!.id),
  ).githubToken(url.origin, [`${owner}/${repo}`], true);
  const context = await importGitHubContext(owner, repo, token);
  if (
    context.notes.some((note) => !note.includes("more results are available"))
  )
    return Response.json(
      {
        error:
          "GitHub context could not be refreshed. Existing issues and pull requests were preserved.",
        notes: context.notes,
      },
      { status: 502 },
    );
  const result = await room.refreshGitHubContext(
    context.repo,
    context.issues,
    context.notes,
  );
  return Response.json({
    repo: result,
    issues: context.issues.length,
    pulls: context.repo.pulls.length,
  });
}
