import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkOperatorBindings } from "./check-operator-bindings.mjs";

const root = resolve(import.meta.dirname, "..");
test("real pinned tsrs rejects unresolved operator references and shorthand before cloud work, then accepts corrected bindings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nh-operator-binding-")), file = join(directory, "probe.mjs");
  try {
    for (const source of [
      "export function probe() { const old = {refs: []}; return older.refs; }",
      "export function probe() { const old = {refs: []}; return {older}; }",
    ]) {
      await writeFile(file, source);
      await assert.rejects(() => checkOperatorBindings({ root, files: [file] }), /Operator binding preflight failed/);
    }
    await writeFile(file, "export function probe() { const old = {refs: []}; return old.refs; }");
    assert.deepEqual(await checkOperatorBindings({ root, files: [file] }), {
      files: 1, bindingsChecked: true, fullTypeCheck: false,
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("missing compiler input fails closed and binding success is explicitly distinct from full type checking", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nh-operator-input-")), file = join(directory, "probe.mjs");
  try {
    await assert.rejects(() => checkOperatorBindings({ root, files: [file] }), /could not check all requested inputs/);
    await writeFile(file, "const old = 1; export const value = old.missing;");
    assert.equal((await checkOperatorBindings({ root, files: [file] })).fullTypeCheck, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
