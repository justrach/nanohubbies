/** A deliberately bounded Actions workflow dialect. Unsupported constructs
 * fail explicitly rather than silently changing a required check's meaning. */
import { parseDocument } from "yaml";
const object = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function fields(value, allowed, where) {
  if (!object(value)) throw Error(`${where} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      throw Error(`Unsupported ${where} field: ${key}`);
}
const quote = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
function env(value = {}) {
  if (!object(value)) throw Error("env must be a literal mapping");
  for (const [k, v] of Object.entries(value))
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ||
      typeof v !== "string" ||
      /^(GITHUB_|NANOHUB_|CODEGRAFF_|CI$)/.test(k)
    )
      throw Error(
        "Use literal string env values; runner identity variables are reserved",
      );
  return value;
}
function directory(path = ".") {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.split("/").includes("..") ||
    path.includes("\0")
  )
    throw Error("Working directory must stay inside the checkout");
  return path;
}
function matching(pattern, branch) {
  if (typeof pattern !== "string" || !/^[a-zA-Z0-9_./*?-]+$/.test(pattern))
    throw Error("Unsupported branch filter");
  const r = pattern
    .replace(/[.]/g, "\\.")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replaceAll("\u0000", ".*");
  return new RegExp("^" + r + "$").test(branch);
}
export function parseWorkflow(text, file, branch,ref=`refs/heads/${branch}`) {
  const isTag=ref===`refs/tags/${branch}`;if(!isTag&&ref!==`refs/heads/${branch}`)throw Error('Invalid workflow source ref');
  if (Buffer.byteLength(text) > 64 * 1024 || text.includes("${{"))
    throw Error("Workflow exceeds 64 KiB or uses unsupported expressions");
  const doc = parseDocument(text, { uniqueKeys: true, version: "1.2" });
  if (doc.errors.length) throw Error("Invalid workflow YAML");
  const workflow = doc.toJS({ maxAliasCount: 0 });
  fields(workflow, ["name", "on", "jobs", "env", "permissions"], "workflow");
  let trigger = workflow.on;
  if (typeof trigger === "string") trigger = { [trigger]: null };
  else if (Array.isArray(trigger))
    trigger = Object.fromEntries(trigger.map((t) => [t, null]));
  if (!object(trigger)) throw Error("Declare on: push");
  for (const name of Object.keys(trigger))
    if (!["push", "pull_request"].includes(name))
      throw Error(`Unsupported event: ${name}`);
  if (!Object.hasOwn(trigger, "push"))
    throw Error(
      "This runner dispatches branch and tag pushes; declare on: push (including pre-PR checks)",
    );
  if (trigger.push !== null) {
    fields(trigger.push, ["branches", "branches-ignore","tags","tags-ignore"], "push");
    for (const k of Object.keys(trigger.push))
      if (!Array.isArray(trigger.push[k]))
        throw Error("Branch and tag filters must be arrays");
      else for(const pattern of trigger.push[k])matching(pattern,'');
    if (trigger.push.branches && trigger.push["branches-ignore"])
      throw Error("Choose branches or branches-ignore");
    if(trigger.push.tags&&trigger.push['tags-ignore'])throw Error('Choose tags or tags-ignore');
  }
  if (trigger.pull_request !== undefined && trigger.pull_request !== null)
    throw Error(
      "pull_request filters are not supported; use branch push filters",
    );
  if (workflow.permissions !== undefined) {
    if (
      !object(workflow.permissions) ||
      Object.entries(workflow.permissions).some(
        ([k, v]) => k !== "contents" || v !== "read",
      )
    )
      throw Error("Only contents: read permissions are supported");
  }
  fields(workflow.jobs, Object.keys(workflow.jobs ?? {}), "jobs");
  const jobs = Object.entries(workflow.jobs);
  if (!jobs.length || jobs.length > 16)
    throw Error("Use 1–16 jobs per workflow");
  const slug = file
    .split("/")
    .at(-1)
    .replace(/\.ya?ml$/, "");
  if (!/^[\w.-]{1,50}$/.test(slug)) throw Error("Invalid workflow filename");
  const result = jobs.map(([id, job]) => {
    if (!/^[A-Za-z_][\w-]{0,47}$/.test(id)) throw Error("Invalid job ID");
    fields(
      job,
      ["name", "runs-on", "needs", "steps", "env", "timeout-minutes"],
      "job",
    );
    if (!["codegraff", "ubuntu-latest"].includes(job["runs-on"]))
      throw Error("runs-on must select codegraff or ubuntu-latest");
    const minutes = job["timeout-minutes"] ?? 30;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 45)
      throw Error("Job timeout must be 1–45 minutes");
    let needs = job.needs ?? [];
    if (typeof needs === "string") needs = [needs];
    if (
      !Array.isArray(needs) ||
      needs.some((n) => !jobs.some(([id]) => id === n))
    )
      throw Error("Invalid job dependency");
    if (
      !Array.isArray(job.steps) ||
      !job.steps.length ||
      job.steps.length > 100
    )
      throw Error("Use 1–100 steps per job");
    const jobEnv = { ...env(workflow.env), ...env(job.env) };
    const steps = job.steps.map((step, index) => {
      fields(
        step,
        ["name", "run", "uses", "with", "env", "shell", "working-directory"],
        "step",
      );
      if (step.shell !== undefined && !["bash", "sh"].includes(step.shell))
        throw Error("Unsupported step shell");
      if ((typeof step.run === "string") === !!step.uses)
        throw Error("Each step needs exactly one of run or uses");
      let command = step.run;
      if (step.uses) {
        if (/^actions\/checkout@(v[45]|[a-f0-9]{40})$/.test(step.uses)) {
          fields(
            step.with ?? {},
            ["fetch-depth", "persist-credentials"],
            "checkout",
          );
          if (step.with?.["persist-credentials"] === true)
            throw Error("Checkout never persists credentials");
          if (
            step.with?.["fetch-depth"] !== undefined &&
            step.with["fetch-depth"] !== 0
          )
            throw Error(
              "Checkout uses complete candidate history; use fetch-depth: 0",
            );
          command = 'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"';
        } else if (
          /^actions\/setup-node@(v[456]|[a-f0-9]{40})$/.test(step.uses)
        ) {
          fields(step.with ?? {}, ["node-version"], "setup-node");
          const version = String(step.with?.["node-version"] ?? "");
          if (!/^\d+(\.\d+\.\d+|\.x)?$/.test(version))
            throw Error("Use an explicit Node major or full version");
          const major = version.split(".")[0];
          command = `test "$(node -p 'process.versions.node.split(".")[0]')" = ${quote(major)}`;
          if (version.split(".").length === 3)
            command += ` && test "$(node -p process.versions.node)" = ${quote(version)}`;
        } else
          throw Error(
            `Unsupported action ${step.uses}; use run steps in the pinned toolchain image`,
          );
      } else if (step.with !== undefined)
        throw Error("with requires a supported built-in action");
      if (
        typeof command !== "string" ||
        !command.trim() ||
        command.length > 32768
      )
        throw Error("Invalid run step");
      const shell = step.shell ?? "bash",
        flags = shell === "bash" ? "-e -o pipefail" : "-e";
      const cwd = directory(step["working-directory"]);
      const variables = { ...jobEnv, ...env(step.env) };
      return `printf '%s\\n' ${quote(`Step ${index + 1}: ${step.name ?? step.uses ?? "run"}`)}\n(cd /tmp/work/${quote(cwd)} && env ${Object.entries(
        variables,
      )
        .map(([k, v]) => `${k}=${quote(v)}`)
        .join(" ")} ${shell} ${flags} -c ${quote(command)})`;
    });
    return {
      id,
      name: `${slug}/${id}`,
      workflow: file,
      needs,
      timeoutMs: minutes * 60000,
      script: "set -e\n" + steps.join("\n"),
    };
  });
  const ordered = [],
    visiting = new Set(),
    visited = new Set();
  function visit(job) {
    if (visiting.has(job.id)) throw Error("Cyclic job dependencies");
    if (visited.has(job.id)) return;
    visiting.add(job.id);
    for (const need of job.needs) visit(result.find((j) => j.id === need));
    visiting.delete(job.id);
    visited.add(job.id);
    ordered.push(job);
  }
  for (const job of result) visit(job);
  const filter = trigger.push;
  const include=isTag?'tags':'branches',exclude=isTag?'tags-ignore':'branches-ignore',other=isTag?'branches':'tags',otherIgnore=isTag?'branches-ignore':'tags-ignore';
  if (
    (filter?.[include] && !filter[include].some((p) => matching(p, branch))) ||
    filter?.[exclude]?.some((p) => matching(p, branch))||
    filter&&!filter[include]&&!filter[exclude]&&(filter[other]||filter[otherIgnore])
  )
    return [];
  return ordered;
}
export { quote };
