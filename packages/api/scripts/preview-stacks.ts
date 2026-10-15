// Creates a local-only review fixture for interactive browser verification.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, call, signIn } from "./client.ts";

if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(BASE)) throw new Error("Preview fixtures run only on localhost");
const trunk = `review-demo-${Date.now().toString(36)}`;
const cookie = await signIn("stack-owner");
await call("POST", `/api/trunks/${trunk}`, { files: [{ path: "README.md", text: "# Agent workspace\n\nA local fixture for reviewing stacked changes.\n" }] }, cookie);
const { token, id } = await call<{ token: string; id: string }>("POST", "/api/tokens", { trunk, label: "local review fixture" }, cookie);
const root = mkdtempSync(join(tmpdir(), "review-preview-"));
const auth = `Authorization: Basic ${Buffer.from(`preview:${token}`).toString("base64")}`;
const git = (...args: string[]) => execFileSync("git", ["-c", "credential.helper=", "-C", root, ...args], { stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
try {
  git("clone", "-q", `${BASE}/git/${trunk}.git`, ".");
  git("config", "user.name", "Preview agent"); git("config", "user.email", "preview@nanohub.invalid");
  for (const [branch, path, text] of [
    ["feature/task-schema", "schema.ts", 'export interface Task {\n  id: string;\n  title: string;\n  status: "open" | "done";\n}\n'],
    ["feature/task-api", "tasks.ts", 'import type { Task } from "./schema";\n\nexport function openTasks(tasks: Task[]): Task[] {\n  return tasks.filter((task) => task.status === "open");\n}\n'],
  ]) {
    git("switch", "-qc", branch); writeFileSync(join(root, path), text);
    git("add", path); git("commit", "-qm", `Add ${path}`);
    git("-c", `http.extraHeader=${auth}`, "push", "origin", branch);
  }
  console.log(JSON.stringify({ trunk, url: `http://localhost:3010/t/${trunk}/pulls` }));
} finally {
  await call("DELETE", `/api/tokens/${id}`, undefined, cookie);
  rmSync(root, { recursive: true, force: true });
}
