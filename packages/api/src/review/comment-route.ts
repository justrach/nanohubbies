import { settings, type User } from "../auth";
import { browse } from "../browse/routes";
import { pusher } from "../tokens";
import { anchorInPatch, type CodeAnchor } from "./comments";

/** Caller has already passed the workspace authorization boundary. */
export async function commentRoute(
  env: Env,
  request: Request,
  trunk: string,
  rawVersion: string | undefined,
  user: User | null,
) {
  const version = Number(rawVersion);
  if (!Number.isSafeInteger(version) || version < 1)
    return Response.json(
      { error: "Choose a published version" },
      { status: 400 },
    );
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const [head] = await seq.heads(version, 1);
  if (head?.version !== version)
    return Response.json({ error: "No published version" }, { status: 404 });
  if (request.method === "GET")
    return Response.json(
      await seq.codeComments({ op: "list", commit: head.commit }),
    );
  if (!["POST", "PATCH"].includes(request.method))
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  const url = new URL(request.url);
  const credential = request.headers.has("authorization")
    ? await pusher(env, request, trunk)
    : null;
  if (request.headers.has("authorization") && !credential)
    return Response.json(
      { error: "Invalid agent credential" },
      { status: 401 },
    );
  const author = credential
    ? {
        id: credential.agentId ?? credential.owner.id,
        name: credential.agent ?? credential.owner.name,
      }
    : user
      ? { id: user.id, name: user.name }
      : null;
  if (!author)
    return Response.json(
      { error: "Sign in to comment on code" },
      { status: 401 },
    );
  const origin = request.headers.get("origin");
  const preview =
    origin &&
    settings(env, url).dev &&
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    new URL(origin).hostname === url.hostname;
  if (origin && origin !== url.origin && !preview)
    return Response.json(
      { error: "Same-origin request required" },
      { status: 403 },
    );
  if (Number(request.headers.get("content-length")) > 24000)
    return Response.json({ error: "Comment is too large" }, { status: 413 });
  const text = await request.text();
  if (text.length > 24000)
    return Response.json({ error: "Comment is too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "Invalid comment JSON" }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    body.commit !== head.commit ||
    typeof body.id !== "string" ||
    !/^[a-zA-Z0-9-]{8,80}$/.test(body.id)
  )
    return Response.json(
      { error: "Refresh the change before commenting" },
      { status: 409 },
    );
  try {
    if (request.method === "PATCH") {
      if (typeof body.resolved !== "boolean")
        return Response.json(
          { error: "Choose a thread resolution" },
          { status: 400 },
        );
      return Response.json(
        await seq.codeComments({
          op: "resolve",
          commit: head.commit,
          id: body.id,
          resolved: body.resolved,
        }),
      );
    }
    if (
      typeof body.body !== "string" ||
      !body.body.trim() ||
      body.body.length > 16000 ||
      typeof body.path !== "string" ||
      body.path.length > 2048 ||
      (body.replyTo !== undefined &&
        body.replyTo !== null &&
        typeof body.replyTo !== "string")
    )
      return Response.json(
        {
          error: "Provide a comment of 1–16000 characters and a file selection",
        },
        { status: 400 },
      );
    const anchor = {
      path: body.path,
      side: body.side,
      startLine: body.startLine,
      line: body.line,
    } as CodeAnchor;
    const response = await browse(env, trunk, "commit", String(version), url);
    if (!response.ok) return response;
    const diff = await response.json<{
      files: { path: string; patch: string | null }[];
    }>();
    if (
      !anchorInPatch(
        diff.files.find((f) => f.path === anchor.path)?.patch ?? null,
        anchor,
      )
    )
      return Response.json(
        { error: "Select visible lines from this change's diff" },
        { status: 400 },
      );
    return Response.json(
      await seq.codeComments({
        op: "add",
        comment: {
          ...anchor,
          id: body.id,
          commit: head.commit,
          author,
          body: body.body.trim(),
          at: Date.now(),
          replyTo: (body.replyTo as string | null) ?? null,
          resolved: false,
        },
      }),
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
