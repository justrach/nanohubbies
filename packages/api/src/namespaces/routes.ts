import type { User } from "../auth";
import { createTrunk } from "../creation";
import { requireTeam, sameOrigin } from "../team/access";
import { TeamError } from "../team/provider";
import type { RepositoryAddress } from "./store";
import {creationBody} from "../abuse";
import {newRefName} from "../repository/ref-name";
export function repositoryURLs(origin: string, repo: RepositoryAddress) {
  return {
    ...repo,
    fullName: `${repo.namespace}/${repo.name}`,
    htmlUrl: `${origin}/${repo.namespace}/${repo.name}`,
    cloneUrl: `${origin}/git/${repo.namespace}/${repo.name}.git`,
    apiUrl: `${origin}/api/repos/${repo.namespace}/${repo.name}`,
  };
}
export async function namespaceRoute(
  env: Env,
  request: Request,
  user: User | null,
  requestedName?: string,
) {
  if (request.method === "GET" && requestedName)
    return Response.json({
      exists: await env.HUB.get(env.HUB.idFromName("hub")).namespaceExists(
        requestedName,
      ),
    });
  if (!user || request.headers.has("authorization"))
    return Response.json(
      { error: "Sign in to choose an owner handle" },
      { status: 401 },
    );
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  if (request.method === "GET")
    return Response.json({ namespace: await hub.namespaceFor(user.id) });
  if (request.method !== "POST" || !sameOrigin(env, request))
    return Response.json(
      { error: "Same-origin request required" },
      { status: 403 },
    );
  const { name } = await request.json<{ name: string }>();
  return Response.json(await hub.claimNamespace(name, user.id), {
    status: 201,
  });
}
/** Resolve a public address before using any storage, credential or ACL key.
 * All bytes and authorization remain scoped to the immutable repository ID. */
export async function namespacedAPI(
  env: Env,
  request: Request,
  user: User | null,
  namespace: string,
  name: string,
  rest: string[],
) {
  const hub = env.HUB.get(env.HUB.idFromName("hub")),
    url = new URL(request.url);
  if (request.method === "POST" && !rest.length) {
    if (
      !user ||
      request.headers.has("authorization") ||
      !sameOrigin(env, request)
    )
      return {
        response: Response.json(
          { error: "A same-origin owner session is required" },
          { status: 403 },
        ),
      };
    const body=await creationBody<{defaultBranch?:string}>(request,4096);
    if(Object.keys(body).some(key=>key!=="defaultBranch"))throw Error("New repositories accept an initial defaultBranch only");
    if(body.defaultBranch!==undefined){if(typeof body.defaultBranch!=="string")throw Error("Choose a valid initial default branch name");newRefName(`refs/heads/${body.defaultBranch}`);}
    const repo = await hub.reserveRepository(namespace, name, user.id);
    // Reserve the address before dispatching initialization. On a lost reply,
    // retain it, so retries cannot create an unrelated repository behind it.
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    headers.set("content-type", "application/json");
    const response = await createTrunk(
      new Request(request.url, {method:"POST", headers, body: JSON.stringify({ mode: "git",...body }) }),
      env,
      url,
      repo.id,
      user,
      false,
    );
    if (!response.ok) return { response };
    return {
      response: Response.json(repositoryURLs(url.origin, repo), {
        status: 201,
      }),
    };
  }
  const repo = await hub.resolveRepository(namespace, name);
  if (!repo) throw new TeamError("Repository not found", 404, "not_found");
  if (request.method === "POST" && rest[0] === "address") {
    if (
      !user ||
      request.headers.has("authorization") ||
      !sameOrigin(env, request)
    )
      return {
        response: Response.json(
          { error: "A same-origin owner session is required" },
          { status: 403 },
        ),
      };
    await requireTeam(env, request, repo.id, user);
    const { name: next } = await request.json<{ name: string }>();
    return {
      response: Response.json(
        repositoryURLs(
          url.origin,
          await hub.renameRepository(repo.id, next, user.id),
        ),
      ),
    };
  }
  // GET of the named resource returns identity + canonical addresses, fenced
  // by exactly the same current membership as Git and every nested API.
  if (request.method === "GET" && !rest.length) {
    await requireTeam(env, request, repo.id, user);
    if (!(await hub.find(repo.id)))
      throw new TeamError("Repository not found", 404, "not_found");
    return { response: Response.json(repositoryURLs(url.origin, repo)) };
  }
  return { id: repo.id };
}
