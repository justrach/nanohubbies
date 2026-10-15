import { isDir, readTree } from "../git";
import type { Sequencer } from "../sequencer";
import { entryAt } from "../trees";
import type { Head } from "../types";
import { changesBetween, patchBetween, PatchTooBig, readCommit, summaries, summarize } from "./history";
import { TooBig, TrunkObjects } from "./objects";
import { mbox } from "./ship";
import { cached, cachedResponse } from "./cache";

//   GET /api/trunks/:t/tree?v=&path=          a directory at a version (the published head by default), with its README
//   GET /api/trunks/:t/blob?v=&path=          one file, as JSON · /raw?v=&path= the same file as plain text
//   GET /api/trunks/:t/commits?from=&limit=   the history, newest first, from version `from` down
//   GET /api/trunks/:t/commit/:v              one version (or a commit sha): its message and its diff, file by file
//   GET /api/trunks/:t/compare?from=&to=      everything that changed between two versions
//   GET /api/trunks/:t/patch?from=&to=&format=mbox|diff
//                                             the same as one patch: `git am` takes the mbox, `git apply` the diff
export const BROWSE = new Set(["tree", "blob", "raw", "commits", "commit", "compare", "patch"]);

/** The trunk read like any git host's repository: everything here is read
 *  from the git objects in R2, at published versions, so the sequencer only
 *  answers which commit a version is. */
export async function browse(env: Env, trunk: string, action: string, id: string | undefined, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const cache = <T>(key: unknown[], load: () => Promise<T>) => cached(env.BROWSE_CACHE, [url.origin, trunk, ...key], load, ctx);
  const q = (k: string) => url.searchParams.get(k) ?? "";
  const objects = new TrunkObjects(env, trunk, action === "patch" ? 9000 : 4000);
  const at = async (raw: string): Promise<Head> => {
    if (!raw) return seq.head();
    const v = Number(raw);
    if (!Number.isSafeInteger(v) || v < 1) throw new Missing(`no version ${raw}`);
    const [head] = await seq.heads(v, 1);
    if (head?.version !== v) throw new Missing(`v${v} is not published yet`);
    return head;
  };
  try {
    if (action === "tree") {
      const head = await at(q("v"));
      const path = clean(q("path"));
      return cachedResponse(await cache(["tree", head, path], async () => {
        const dir = await entryAt(objects, head.tree, path);
        if (!dir || !isDir(dir)) throw new Missing(`no directory ${path} at v${head.version}`);
        const entries = readTree(await objects.body(dir.sha, "tree"))
          .map((e) => ({ name: e.name, path: path ? `${path}/${e.name}` : e.name, type: isDir(e) ? ("dir" as const) : ("file" as const), sha: e.sha }))
          .sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
        const readme = entries.find((e) => e.type === "file" && /^readme(\.(md|markdown|txt))?$/i.test(e.name));
        const [latest, text] = await Promise.all([readCommit(objects, head), readme ? objects.text(readme.sha) : null]);
        return {
          version: head.version,
          commit: head.commit,
          path,
          entries,
          readme: readme && text !== null ? { path: readme.path, text: text.slice(0, 512 * 1024) } : null,
          latest: summarize(head.version, latest),
        };
      }));
    }
    if (action === "blob" || action === "raw") {
      const head = await at(q("v"));
      const path = clean(q("path"));
      const load = async () => {
        const file = path ? await entryAt(objects, head.tree, path) : null;
        if (!file || isDir(file)) throw new Missing(`no file ${path} at v${head.version}`);
        const text = await objects.text(file.sha);
        if (action === "raw") return text;
        const big = text.length > 1 << 20;
        return { version: head.version, commit: head.commit, path, sha: file.sha, size: new TextEncoder().encode(text).length, text: big ? null : text };
      };
      if (action === "raw") return text(await load() as string);
      return cachedResponse(await cache(["blob", head, path], load));
    }
    if (action === "commits") {
      const limit = Math.min(100, Math.max(1, Number(q("limit")) || 30));
      const head = await seq.head();
      const heads = await seq.heads(Number(q("from")) || head.version, limit + 1);
      const result = await cache(["commits", heads, limit], async () => ({ commits: await summaries(objects, heads.slice(0, limit)), next: heads[limit]?.version ?? null }));
      return cachedResponse({ ...result, value: { head: head.version, ...result.value } });
    }
    if (action === "commit") {
      const head = await at(await versionOf(seq, id ?? ""));
      const parent = head.version > 1 ? await at(String(head.version - 1)) : null;
      return cachedResponse(await cache(["commit", head, parent], async () => {
        const commit = await readCommit(objects, head);
        return { ...summarize(head.version, commit), trailers: commit.trailers, parent: parent?.version ?? null, ...(await changesBetween(objects, parent?.tree ?? null, head.tree)) };
      }));
    }
    if (action === "compare") {
      const [from, to] = await Promise.all([at(q("from") || "1"), at(q("to"))]);
      return cachedResponse(await cache(["compare", from, to], async () => ({ from: from.version, to: to.version, ...(await changesBetween(objects, from.tree, to.tree)) })));
    }
    if (action === "patch") {
      const [from, to] = await Promise.all([at(q("from") || "1"), at(q("to"))]);
      const { diff, files } = await patchBetween(objects, from.tree, to.tree);
      if (!files) return text(`v${from.version} and v${to.version} have the same files: there is nothing to send\n`, 404);
      if (q("format") === "diff") return text(diff);
      const newest = await summaries(objects, await seq.heads(to.version, Math.min(50, to.version - from.version)));
      const repo = await env.ROOM.get(env.ROOM.idFromName(trunk)).repo();
      return text(mbox({ trunk, origin: url.origin, from, to, files, newest, repo, diff }));
    }
  } catch (e) {
    if (e instanceof Missing) return json({ error: e.message }, 404);
    if (e instanceof TooBig || e instanceof PatchTooBig) return json({ error: e.message }, 413);
    throw e;
  }
  return json({ error: "not found" }, 404);
}

class Missing extends Error {}

/** A version number as given, or the version a commit sha landed as. */
async function versionOf(seq: DurableObjectStub<Sequencer>, id: string): Promise<string> {
  if (/^\d{1,12}$/.test(id)) return id;
  if (!/^[0-9a-f]{40}$/.test(id)) throw new Missing(`no version or commit ${id}`);
  const found = (await seq.versionsOf([id]))[id];
  if (!found) throw new Missing(`no published version has the commit ${id}`);
  return String("head" in found ? found.head.version : found.pushedAs);
}

/** A path inside the tree: no leading or trailing slash, no "." or ".." parts. */
function clean(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === "..")) throw new Missing(`bad path: ${path}`);
  return parts.join("/");
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
