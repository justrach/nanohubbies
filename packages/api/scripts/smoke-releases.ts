// Releases end to end on an isolated Worker (real SQLite DOs, R2, D1; no
// hosted bindings): the owner drafts a release at a published version,
// attaches files and publishes it, and anyone downloads them. Nobody else
// manages it, drafts stay the owner's, tags are unique, a workspace's files
// are capped, and deleting a release or its workspace deletes its files, so a
// new workspace of the same name starts with none. Run from packages/api:
//   node scripts/smoke-releases.ts
import assert from "node:assert/strict";
import { teamFixture } from "./team/fixture.ts";

const f = await teamFixture({ RELEASE_MAX_BYTES: "64" });
try {
  const owner = await f.login("release-owner", "101");
  const other = await f.login("release-other", "202");
  const trunk = "releases-test", base = `/api/trunks/${trunk}`;
  const bucket = await f.mf.getR2Bucket("OBJECTS");
  const upload = (id: string, name: string, text: string, headers: Record<string, string> = owner) =>
    fetch(`${f.origin}${base}/releases/${id}/assets?name=${encodeURIComponent(name)}`, { method: "POST", headers: { Origin: f.origin, ...headers }, body: text });
  const publicList = async () => (await f.request("GET", `/api/public-releases/${trunk}`)).json() as Promise<any[]>;

  await f.json("POST", base, { files: [{ path: "README.md", text: "Release fixture\n" }] }, owner);
  const draft = (await f.json("POST", `${base}/releases`, { tag: "v1.0.0", title: "First", notes: "What changed", version: 1 }, owner)).releases[0];
  assert.equal(draft.state, "draft");
  assert.match(draft.commit, /^[0-9a-f]{40}$/);
  const again = await f.request("POST", `${base}/releases`, { tag: "v1.0.0", title: "Again", notes: "", version: 1 }, owner);
  assert.equal(again.status, 400);
  assert.match((await again.json() as { error: string }).error, /already exists/);
  assert.equal((await f.request("POST", `${base}/releases`, { tag: "v9", title: "Later", notes: "", version: 9 }, owner)).status, 409);
  console.log("ok: a draft pins a published version's commit; tags are unique; unpublished versions are refused");

  const seen = await (await f.request("GET", `${base}/releases`)).json() as { releases: unknown[]; canManage: boolean };
  assert.deepEqual(seen.releases, []);
  assert.equal(seen.canManage, false);
  assert.deepEqual(await publicList(), []);
  assert.equal((await f.request("POST", `${base}/releases/${draft.id}/publish`, {}, other)).status, 403);
  assert.equal((await upload(draft.id, "x.txt", "x", other)).status, 403);
  assert.equal((await upload(draft.id, "x.txt", "x", { ...owner, Origin: "https://elsewhere.example" })).status, 403);
  console.log("ok: drafts are the owner's; others and other origins cannot manage releases");

  assert.equal((await upload(draft.id, "notes.txt", "hello release\n")).status, 200);
  assert.equal((await upload(draft.id, "notes.txt", "again\n")).status, 400);
  const big = await upload(draft.id, "big.bin", "x".repeat(60));
  assert.equal(big.status, 413);
  assert.match((await big.json() as { error: string }).error, /limited to/);
  assert.equal((await upload(draft.id, "dir/file.txt", "x")).status, 400);
  console.log("ok: files attach to drafts with unique names, within the workspace's cap");

  const published = (await f.json("POST", `${base}/releases/${draft.id}/publish`, {}, owner)).releases[0];
  assert.equal(published.state, "published");
  assert.equal((await upload(draft.id, "late.txt", "late")).status, 409);
  const [listed] = await publicList();
  assert.equal(listed.tag, "v1.0.0");
  assert.deepEqual(Object.keys(listed.assets[0]).sort(), ["id", "name", "size"]);
  assert.equal(listed.commit, undefined);
  const visitor = (await (await f.request("GET", `${base}/releases`)).json() as { releases: any[] }).releases[0];
  assert.equal(visitor.assets[0].key, undefined);
  const download = await f.request("GET", `/api/public-releases/${trunk}/${listed.id}/${listed.assets[0].id}`);
  assert.equal(await download.text(), "hello release\n");
  assert.match(download.headers.get("content-disposition") ?? "", /filename\*=UTF-8''notes\.txt/);
  console.log("ok: a published release lists and downloads for anyone, without internal fields");

  const second = (await f.json("POST", `${base}/releases`, { tag: "v1.1.0", title: "Second", notes: "", version: 1 }, owner)).releases.find((r: any) => r.tag === "v1.1.0");
  assert.equal((await upload(second.id, "extra.txt", "extra\n")).status, 200);
  const keys = (await f.json("GET", `${base}/releases`, undefined, owner)).releases.flatMap((r: any) => r.assets.map((a: any) => a.key));
  assert.equal(keys.length, 2);
  const secondKey = (await f.json("GET", `${base}/releases`, undefined, owner)).releases.find((r: any) => r.id === second.id).assets[0].key;
  const left = (await f.json("DELETE", `${base}/releases/${second.id}`, undefined, owner)).releases;
  assert.deepEqual(left.map((r: any) => r.tag), ["v1.0.0"]);
  assert.equal(await bucket.head(secondKey), null);
  console.log("ok: deleting a release deletes its files");

  await f.json("DELETE", base, undefined, owner);
  for (const key of keys) assert.equal(await bucket.head(key), null);
  await f.json("POST", base, { files: [{ path: "README.md", text: "Someone else's\n" }] }, other);
  assert.deepEqual(await publicList(), []);
  assert.deepEqual((await f.json("GET", `${base}/releases`, undefined, other)).releases, []);
  console.log("ok: deleting a workspace deletes its releases and files; a new workspace of that name starts with none");
} finally {
  await f.close();
}
