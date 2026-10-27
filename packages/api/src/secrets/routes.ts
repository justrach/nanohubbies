import { creationBody } from "../abuse";
import type { User } from "../auth";
import {
  canAdmin,
  sameOrigin,
  ownerEvidence,
  type TeamAccess,
} from "../team/access";
import type { VaultService, Scope } from "../../../vault/src/index";
const client = (env: Env) =>
  (
    env as unknown as {
      VAULT?: Pick<
        VaultService,
        "list" | "put" | "remove" | "grant" | "revoke" | "principal" | "redeem"
      >;
    }
  ).VAULT;
const unavailable = () =>
  Response.json(
    { error: "The separate vault service is not configured" },
    { status: 503 },
  );
export async function secretRoute(
  env: Env,
  request: Request,
  trunk: string,
  user: User | null,
  access: TeamAccess | null,
) {
  if (!user || request.headers.has("authorization") || !canAdmin(access))
    return Response.json(
      {
        error: "Only a signed-in repository owner or admin can manage secrets",
      },
      { status: 403 },
    );
  const vault = client(env);
  if (!vault) return unavailable();
  const environment =
    new URL(request.url).searchParams.get("environment") ?? "staging";
  const scope: Scope = { repository: trunk, environment, actor: user.id };
  try {
    if (request.method === "GET") return Response.json(await vault.list(scope));
    if (!sameOrigin(env, request))
      return Response.json(
        { error: "Same-origin request required" },
        { status: 403 },
      );
    const body = await creationBody<{
      name: string;
      binding: string;
      names: string[];
      ttlSeconds: number;
      grantId?: string;
    }>(request, 16 * 1024);
    if (request.method === "PUT") {
      if (Object.hasOwn(body, "value"))
        return Response.json(
          {
            error:
              "Enter secret values in Cloudflare Secrets Store; Nanohub accepts a binding reference only",
          },
          { status: 400 },
        );
      return Response.json(
        await vault.put(scope, { name: body.name, binding: body.binding }),
      );
    }
    if (request.method === "POST")
      return Response.json(
        await vault.grant(scope, {
          names: body.names,
          ttlSeconds: body.ttlSeconds,
        }),
        { status: 201 },
      );
    if (request.method === "DELETE")
      return Response.json(
        body.grantId
          ? await vault.revoke(scope, body.grantId)
          : await vault.remove(scope, body.name),
      );
    return Response.json({ error: "Method not supported" }, { status: 405 });
  } catch {
    return Response.json(
      {
        error:
          "Vault operation failed; check the scope, names, limits and service configuration",
      },
      { status: 400 },
    );
  }
}
export async function workloadSecrets(
  env: Env,
  request: Request,
  trunk: string,
) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (request.method !== "POST" || !/^nhv_[a-f0-9]{64}$/.test(token))
    return Response.json(
      { error: "A workload grant is required" },
      { status: 403 },
    );
  const vault = client(env);
  if (!vault) return unavailable();
  try {
    const environment =
      new URL(request.url).searchParams.get("environment") ?? "staging";
    const scope = { repository: trunk, environment, actor: "workload" };
    await env.HUB.get(env.HUB.idFromName("hub")).assertRepositoryWritable(trunk);
    const actor = await vault.principal(scope, token);
    const hub = env.HUB.get(env.HUB.idFromName("hub")),
      binding = await hub.team(trunk);
    if (!binding || !(await hub.find(trunk)))
      throw new Error("Repository unavailable");
    if (binding.kind === "owner") {
      if (
        !["owner", "admin"].includes(
          (await hub.collaboratorRole(trunk, actor)) ?? "",
        )
      )
        throw new Error("Issuer no longer authorized");
    } else {
      const evidence = await ownerEvidence(
        env,
        new URL(request.url).origin,
        actor,
        [binding.roomId],
      );
      if (
        evidence.issuer !== binding.issuer ||
        !evidence.rooms.some(
          (r) => r.id === binding.roomId && r.role === "owner",
        )
      )
        throw new Error("Issuer no longer authorized");
    }
    await hub.assertRepositoryWritable(trunk);
    const redeemed=await vault.redeem(scope, token);
    await hub.assertRepositoryWritable(trunk);
    return Response.json(redeemed);
  } catch {
    return Response.json(
      { error: "Workload grant unavailable" },
      { status: 403 },
    );
  }
}
