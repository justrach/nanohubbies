import { settings, type User } from "../auth";
import { changesBetween } from "../browse/history";
import { TrunkObjects } from "../browse/objects";
import { entryAt } from "../trees";
import { isDir, readTree } from "../git";
import { pusher } from "../tokens";
import type { Owner } from "../types";
import { mergeBase, mergeEdits, publishObjects, replay, restackCommit } from "./graph";
import { branchName, type Branch, type Review } from "./types";

/** Called only after the workspace's ordinary authorization boundary. */
export async function reviewRoute(env: Env, request: Request, trunk: string, action: string, id: string | undefined, operation: string | undefined, user: User | null) {
  const url = new URL(request.url), method = request.method;
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const s = await seq.review({ op: "snapshot" });
  const objects = new TrunkObjects(env, trunk, 16000);
  const branch = (name: string): Branch => {
    const b = s.branches.find((b) => b.name === name);
    if (!b) throw new Error(`No branch ${name}`);
    return b;
  };
  let owner: Owner | null = user ? { id: user.id, name: user.name } : null;
  let actor: Owner | null = owner;
  if (method !== "GET") {
    const credential = request.headers.has("authorization") ? await pusher(env, request, trunk) : null;
    if (request.headers.has("authorization") && !credential) return Response.json({ error: "Invalid agent credential" }, { status: 401 });
    owner = credential?.owner ?? owner;
    actor = credential ? { id: credential.agentId ?? credential.owner.id, name: credential.agent ?? credential.owner.name } : owner;
    if (!owner) return Response.json({ error: "Sign in or use a workspace agent credential" }, { status: 401 });
    const origin = request.headers.get("origin");
    const localPreview = origin && settings(env, url).dev && ["localhost", "127.0.0.1"].includes(url.hostname)
      && new URL(origin).hostname === url.hostname;
    if (origin && origin !== url.origin && !localPreview) return Response.json({ error: "Same-origin request required" }, { status: 403 });
  }
  if (action === "branches") {
    if (method === "GET" && !id) return Response.json(s);
    if (method === "GET" && id === "tree") {
      const b = branch(url.searchParams.get("name") ?? "main");
      const path = url.searchParams.get("path") ?? "";
      if (path.split("/").some((p) => p === ".." || p === ".") || path.includes("\\")) throw new Error("Invalid path");
      const e = await entryAt(objects, b.tree, path);
      if (!e) return Response.json({ error: "No such path" }, { status: 404 });
      return Response.json(isDir(e)
        ? { branch: b, path, entries: readTree(await objects.body(e.sha, "tree")).map((e) => ({ name: e.name, directory: isDir(e) })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) }
        : { branch: b, path, text: await objects.text(e.sha) });
    }
    if (method === "POST" && !id) {
      const body = await request.json<{ name: string; from?: string }>();
      const name = branchName(body.name), source = branch(body.from ?? "main");
      return Response.json(await seq.review({ op: "branch", name, old: null, source, next: source }));
    }
    if (method === "DELETE" && !id) {
      const body = await request.json<{ name: string; commit: string }>();
      return Response.json(await seq.review({ op: "branch", name: branchName(body.name), old: body.commit, next: null }));
    }
  }
  if (action === "pulls") {
    if (!id) {
      if (method === "GET") return Response.json(s);
      if (method === "POST") {
        const body = await request.json<{ title: string; body?: string; head: string; base?: string }>();
        const head = branch(body.head), base = branch(body.base ?? "main");
        const anchor = await mergeBase(objects, head.commit, base.commit);
        if (head.tree === anchor.tree) throw new Error("This branch has no changes to review");
        return Response.json(await seq.review({ op: "open", title: body.title, body: body.body ?? "", head, base, anchor: anchor.commit, anchorTree: anchor.tree, author: actor! }));
      }
    } else {
      const p = s.pulls.find((p) => p.number === Number(id));
      if (!p) return Response.json({ error: "No such pull request" }, { status: 404 });
      const head = p.state === "open" ? branch(p.head) : { name: p.head, commit: p.headCommit, tree: p.headTree, updatedAt: p.updatedAt };
      if (method === "GET" && operation === "file") {
        const before = url.searchParams.get("side") === "base", path = url.searchParams.get("path") ?? "";
        const file = await entryAt(objects, before ? p.anchorTree : head.tree, path);
        if (!file || isDir(file)) return Response.json({ error: "No file at this PR revision" }, { status: 404 });
        return Response.json({ path, commit: before ? p.anchor : head.commit, text: await objects.text(file.sha) });
      }
      if (method === "GET" && !operation) return Response.json({ ...s, pull: p, head, ...(await changesBetween(objects, p.anchorTree, head.tree)) });
      if (method === "POST" && operation === "close") return Response.json(await seq.review({ op: "close", number: p.number }));
      if (method === "POST" && ["reviews", "restack", "merge"].includes(operation ?? "")) {
        const body = await request.json<{ commit: string; anchor: string; body?: string; verdict?: Review["verdict"] }>();
        if (operation === "merge" && p.state === "merged") return Response.json(s);
        if (body.commit !== head.commit || body.anchor !== p.anchor) return Response.json({ error: "PR changed; refresh and review its latest diff" }, { status: 409 });
        if (operation === "reviews") return Response.json(await seq.review({ op: "review", number: p.number, author: actor!, body: body.body ?? "", verdict: body.verdict ?? "COMMENT", commit: head.commit, anchor: p.anchor }));
        if (operation === "merge" && p.base !== "main") return Response.json({ error: "Merge the parent PR first" }, { status: 409 });
        const base = branch(p.base);
        const result = await replay(objects, p.anchorTree, head.tree, base.tree);
        if (operation === "restack") {
          const made = restackCommit(result.root, base.commit, actor!, p.title);
          await publishObjects(env, trunk, [...result.objects, made]);
          return Response.json(await seq.review({ op: "restack", number: p.number, head, base, anchor: p.anchor, next: { commit: made.sha, tree: result.root } }));
        }
        const main = await seq.head();
        if (main.commit !== base.commit) return Response.json({ error: "Main changed; refresh and try again" }, { status: 409 });
        const edits = await mergeEdits(objects, result.patches, main.tree);
        if (!edits.length) throw new Error("These changes are already on main; close this PR");
        const merged = await seq.review({ op: "merge", number: p.number, head, base: main, anchor: p.anchor,
          request: { id: `pr-${p.number}-${head.commit}-${main.commit}`, agent: "review", owner, kind: "agent", life: 0, intent: `Merge #${p.number}: ${p.title}`, base: main.version,
            reads: { strong: [], weak: [] }, edits, issue: null, closes: false } });
        const landed = merged.pulls.find((q) => q.number === p.number)!;
        if (landed.mergedVersion) await seq.whenPublished(landed.mergedVersion);
        return Response.json(merged);
      }
    }
  }
  return Response.json({ error: "Method or route not supported" }, { status: 405 });
}
