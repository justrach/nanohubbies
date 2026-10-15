import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { CodeComments, anchorInPatch } from "../src/review/comments.ts";

const patch = "@@ -2,3 +2,3 @@\n kept\n-old\n+new\n end\n@@ -20 +20 @@\n-old2\n+new2\n";
const anchor = { path: "src/main.ts", side: "RIGHT", startLine: 2, line: 4 };
test("review anchors stay within one visible hunk and retain old/new sides", () => {
  assert.equal(anchorInPatch(patch, anchor), true);
  assert.equal(anchorInPatch(patch, { ...anchor, side: "LEFT" }), true);
  for (const change of [{ startLine: 1 }, { line: 20 }, { startLine: 0 }, { side: "BOTH" }, { line: 2.5 }, { line: 300 }]) assert.equal(anchorInPatch(patch, { ...anchor, ...change }), false);
  assert.equal(anchorInPatch(null, anchor), false);
  assert.equal(anchorInPatch("@@ -2,0 +2,1 @@\n+new\n", { ...anchor, startLine: 2, line: 2, side: "LEFT" }), false);
});

function storage(db) {
  return { exec(query, ...args) {
    const rows = db.prepare(query).all(...args);
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; } };
  } };
}
const root = { ...anchor, id: "root-comment", commit: "a".repeat(40), author: { id: "reviewer", name: "Reviewer" }, body: "Handle the empty input here.", at: 1, replyTo: null, resolved: false };
test("comments survive store recreation, retry safely, and bind replies to the same code", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const store = new CodeComments(storage(db));
    assert.equal(store.run({ op: "add", comment: root }).comments.length, 1);
    assert.equal(store.run({ op: "add", comment: root }).comments.length, 1);
    assert.throws(() => store.run({ op: "add", comment: { ...root, body: "different" } }), /already used/);
    assert.throws(() => store.run({ op: "add", comment: { ...root, author: { id: "other", name: "Other" } } }), /already used/);
    const reply = { ...root, id: "reply-comment", body: "I will add the guard.", replyTo: root.id, at: 2 };
    assert.throws(() => store.run({ op: "add", comment: { ...reply, path: "other.ts" } }), /selection/);
    store.run({ op: "add", comment: reply });
    const reopened = new CodeComments(storage(db));
    assert.equal(reopened.run({ op: "list", commit: root.commit }).comments.length, 2);
    assert.equal(reopened.run({ op: "list", commit: "b".repeat(40) }).comments.length, 0);
    assert.equal(reopened.run({ op: "resolve", commit: root.commit, id: root.id, resolved: true }).comments[0].resolved, true);
    assert.equal(reopened.run({ op: "resolve", commit: root.commit, id: root.id, resolved: false }).comments[0].resolved, false);
    assert.throws(() => reopened.run({ op: "resolve", commit: root.commit, id: reply.id, resolved: true }), /root thread/);
  } finally { db.close(); }
});
