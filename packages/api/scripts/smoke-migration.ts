import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { teamFixture } from "./team/fixture.ts";
import { migrate } from "../../../tools/migrate-repository.mjs";
const source = process.argv[2];
if (!source) throw Error("Provide a local source repository; only committed objects/refs are read");
const f = await teamFixture();
try {
  const owner = await f.login("migration-owner", "101"), base = "/api/trunks/migration-copy";
  await f.json("POST", base, { mode: "git" }, owner);
  await f.json("POST", `${base}/agents`, { handle: "migration", type: "git" }, owner);
  const { token } = await f.json("POST", `${base}/agents/migration/token`, {}, owner);
  let importedSource = source;
  if (process.argv.includes("--candidate")) {
    const exec = promisify(execFile);
    importedSource = join(f.dir, "committed-candidate.git");
    await exec("git", ["clone", "--bare", "--single-branch", "--shared", source, importedSource]);
    const { stdout } = await exec("git", ["-C", source, "rev-parse", "HEAD"]);
    await exec("git", ["--git-dir", importedSource, "update-ref", "refs/heads/main", stdout.trim()]);
    console.log(JSON.stringify({ scope: "committed HEAD candidate and its complete reachable history; historical side branches excluded", commit: stdout.trim() }));
  }
  console.log(JSON.stringify(await migrate(importedSource, `${f.origin}/git/migration-copy.git`, "migration", token, event => console.log(JSON.stringify(event))), null, 2));
} finally { await f.close(); }
