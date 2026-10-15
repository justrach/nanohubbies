import assert from "node:assert/strict";
import test from "node:test";
import { filterIssues } from "../src/components/issues/model.ts";
const issues = [
  {
    number: 3,
    title: "Fix login",
    author: "Alex",
    heldBy: null,
    state: "open",
    labels: [{ name: "bug" }],
  },
  {
    number: 12,
    title: "Login docs",
    author: "Sam",
    heldBy: "writer",
    state: "closed",
    labels: [{ name: "docs" }],
  },
  {
    number: 4,
    title: "Signup bug",
    author: "Alex",
    heldBy: "builder",
    state: "progress",
    labels: [{ name: "bug" }],
  },
];
test("issue search matches all terms, numbers, labels, authors and working agents", () => {
  assert.deepEqual(
    filterIssues(issues, " LOGIN alex ", "", "newest").map((i) => i.number),
    [3],
  );
  assert.deepEqual(
    filterIssues(issues, "#12", "docs", "newest").map((i) => i.number),
    [12],
  );
  assert.deepEqual(
    filterIssues(issues, "builder", "bug", "newest").map((i) => i.number),
    [4],
  );
  assert.deepEqual(
    filterIssues(issues, "login", "bug", "newest").map((i) => i.number),
    [3],
  );
  assert.deepEqual(filterIssues(issues, "missing", "", "newest"), []);
});
test("sorting is numeric and preserves source data and issue states", () => {
  assert.deepEqual(
    filterIssues(issues, "", "", "newest").map((i) => i.number),
    [12, 4, 3],
  );
  assert.deepEqual(
    filterIssues(issues, "", "", "oldest").map((i) => i.number),
    [3, 4, 12],
  );
  assert.deepEqual(
    issues.map((i) => i.number),
    [3, 12, 4],
  );
  assert.equal(filterIssues(issues, "#12", "", "newest")[0].state, "closed");
});
