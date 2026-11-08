import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const execute = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const operators = [
  "tools/check-operator-bindings.mjs",
  "tools/ci-runner.mjs",
  "tools/sandbox-access.mjs",
  "tools/sandbox-observation.mjs",
  "tools/verify-hosted-git-import.mjs",
  "tools/hosted-recovery-fixture/repository-probe.mjs",
  "tools/hosted-recovery-fixture/phase.mjs",
  "tools/hosted-recovery-fixture/phase-deploy.mjs",
  "tools/hosted-recovery-fixture/phase-assets.mjs",
  "tools/meld-staging-adapter.mjs",
  "tools/meld-pipeline-state.mjs",
  "tools/meld-native-plan.mjs",
  "tools/source-transfer.mjs",
];
// --noResolve does not follow @types/node's reference graph. Supply the Node
// declarations used by these operators explicitly, without traversing app code.
const nodeDeclarations = ["globals", "process", "buffer", "assert/strict", "child_process",
  "crypto", "fs/promises", "os", "path", "url", "util"];

/** Binding/syntax preflight for Node operator JavaScript. --noResolve keeps
 * application dependency type errors out of this deliberately scope-only check.
 * Full Worker/API type checking remains a separate required tsrs gate. */
export async function checkOperatorBindings({ root = projectRoot, files = operators } = {}) {
  if (!isAbsolute(root) || !files.length) throw Error("Operator preflight needs an absolute project and source files");
  let result;
  try {
    const answer = await execute(resolve(root, "node_modules/.bin/tsrs"), [
      "--noEmit", "--noResolve", "--allowJs", "--checkJs", "--pretty", "false",
      "--strict", "false", "--skipLibCheck", "--module", "esnext",
      "--moduleResolution", "bundler", "--target", "es2023", "--types", "node",
      "--allowImportingTsExtensions",
      ...nodeDeclarations.map(name => `node_modules/@types/node/${name}.d.ts`), ...files,
    ], { cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME }, timeout: 60000, maxBuffer: 4 << 20 });
    result = { code: 0, output: answer.stdout + answer.stderr };
  } catch (error) {
    if (error.code !== 2) throw Error("Pinned tsrs operator preflight could not complete");
    result = { code: 2, output: String(error.stdout ?? "") + String(error.stderr ?? "") };
  }
  const diagnostics = [...result.output.matchAll(/^(.+)\((\d+),(\d+)\): error TS(\d+): (.*)$/gm)];
  if (/^error TS\d+:/m.test(result.output) || result.code && !diagnostics.length)
    throw Error("Pinned tsrs operator preflight could not check all requested inputs");
  const selected = new Set(files.map(file => resolve(root, file)));
  const rejected = diagnostics.filter(([, file, , , code]) => selected.has(resolve(root, file)) &&
    ([2304, 2552, 2580, 2591, 18004].includes(Number(code)) || Number(code) < 2000 || Number(code) >= 8000));
  if (rejected.length)
    throw Error("Operator binding preflight failed: " + rejected.map(([, file, line, , code]) => `${file}:${line} (TS${code})`).join(", "));
  return { files: files.length, bindingsChecked: true, fullTypeCheck: false };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkOperatorBindings())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
