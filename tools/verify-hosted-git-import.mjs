/** Opt-in, isolated real Cloudflare acceptance. No production resources reused. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  readFile,
  writeFile,
  mkdir,
  rename,
  rm,
  chmod,
  realpath,
} from "node:fs/promises";
import { resolve, join, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import {
  fixturePlan,
  purgeConfiguration,
  assertFixtureBindings,
} from "./hosted-git-fixture/config.mjs";
import { cleanupFixture } from "./hosted-git-fixture/cleanup.mjs";
import { gitProxy } from "./hosted-git-fixture/proxy.mjs";
import { bucketExists } from "./hosted-git-fixture/observations.mjs";
import { startTrace } from "./hosted-git-fixture/trace.mjs";
import {
  observeWithRetries,
  isProviderObservation,
  wranglerArguments,
} from "./hosted-git-fixture/provider-retry.mjs";
import {
  metadataRows,
  listProviderSecrets,
  ownedSecret,
  assertVaultBindings,
  syntheticValue,
} from "./hosted-recovery-fixture/vault-lifecycle.mjs";
import { waitForFixturePhase } from "./hosted-recovery-fixture/phase.mjs";
import { deployHeldFixturePhase } from "./hosted-recovery-fixture/phase-deploy.mjs";
import { checkOperatorBindings } from "./check-operator-bindings.mjs";
import { purgeFixturePage } from "./hosted-git-fixture/purge.mjs";
const exec = promisify(execFile),
  root = resolve(import.meta.dirname, ".."),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const atomic = async (path, value) => {
  await writeFile(path + ".tmp", JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(path + ".tmp", path);
};
export async function verifyHostedGitImport(
  accountConfig,
  source,
  artifactBase,
  cleanupDirectory,
  purpose = "git-import",
) {
  if (process.env.NANOHUB_LIVE_CLOUDFLARE !== "1")
    throw Error(
      "Set NANOHUB_LIVE_CLOUDFLARE=1 for explicitly isolated hosted acceptance",
    );
  const providerRuntime =
    process.env.NANOHUB_FIXTURE_WRANGLER_RUNTIME ?? "node";
  wranglerArguments([], providerRuntime);
  assert.ok(
    [
      "git-import",
      "storage-recovery",
      "repository-recovery",
      "vault-recovery",
    ].includes(purpose),
  );
  if (!cleanupDirectory && ["repository-recovery", "vault-recovery"].includes(purpose))
    await checkOperatorBindings({ root });
  let saved, previous;
  if (cleanupDirectory) {
    if (!isAbsolute(cleanupDirectory))
      throw Error("Cleanup requires an absolute private receipt directory");
    cleanupDirectory = await realpath(cleanupDirectory);
    saved = JSON.parse(
      await readFile(join(cleanupDirectory, "manifest.json"), "utf8"),
    );
    previous = JSON.parse(
      await readFile(join(cleanupDirectory, "operation.json"), "utf8"),
    );
    assert.equal(saved.root, root);
    purpose = saved.purpose ?? "git-import";
    assert.ok(
      [
        "git-import",
        "storage-recovery",
        "repository-recovery",
        "vault-recovery",
      ].includes(purpose),
    );
    artifactBase = dirname(cleanupDirectory);
  } else {
    if (
      ![accountConfig, source, artifactBase].every(
        (value) => typeof value === "string" && isAbsolute(value),
      )
    )
      throw Error("Use absolute source/config/artifact paths");
    source = await realpath(source);
    await mkdir(artifactBase, { recursive: true, mode: 0o700 });
    artifactBase = await realpath(artifactBase);
  }
  if (
    artifactBase === root ||
    artifactBase.startsWith(root + "/") ||
    (source &&
      (artifactBase === source || artifactBase.startsWith(source + "/")))
  )
    throw Error("Use private artifacts outside source/checkouts");
  const accountId =
    saved?.accountId ??
    /"account_id"\s*:\s*"([a-f0-9]{32})"/.exec(
      await readFile(accountConfig, "utf8"),
    )?.[1];
  if (!accountId)
    throw Error("Account configuration needs one explicit account_id");
  const runId =
      saved?.runId ??
      Date.now().toString(36) + "-" + randomBytes(5).toString("hex"),
    directory = cleanupDirectory ?? join(artifactBase, runId),
    deadline = saved?.deadline ?? Date.now() + 2 * 60 * 60000;
  if (directory === root || directory.startsWith(root + "/"))
    throw Error("Receipt directory must be outside the checkout");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const newKeys = () => ({
    control: randomBytes(32).toString("hex"),
    backend: randomBytes(32).toString("hex"),
    session: randomBytes(32).toString("hex"),
  });
  const keys = cleanupDirectory
    ? await readFile(join(directory, "private-keys.json"), "utf8")
        .then(JSON.parse)
        .catch((error) => {
          if (error.code === "ENOENT" && previous.cleanupNeeded === false)
            return newKeys();
          throw error;
        })
    : newKeys();
  assert.ok(
    ["control", "backend", "session"].every((name) =>
      /^[a-f0-9]{64}$/.test(keys[name]),
    ),
  );
  await atomic(join(directory, "private-keys.json"), keys);
  let plan = fixturePlan({
      root,
      accountId,
      runId,
      deadline,
      databaseId: previous?.databaseId,
      storeId: previous?.storeId,
      purpose,
    }),
    gateOrigin = previous?.gateOrigin ?? "",
    proxy,
    trace,
    clientEnv,
    ownerCookie = "",
    gitToken = "",
    step = previous?.steps.length ?? 0;
  const record = previous ?? {
    format: 1,
    startedAt: new Date().toISOString(),
    providerRuntime,
    controllerRuntime: process.versions.bun
      ? { name: "bun", version: process.versions.bun }
      : { name: "node", version: process.versions.node },
    runId,
    accountId,
    scope: ["repository-recovery", "vault-recovery"].includes(purpose)
      ? "isolated hosted repository DO/D1/R2 loss/restore; real Git and policy checks; independent current revocations; normal traffic held"
      : purpose === "storage-recovery"
        ? "isolated native storage recovery primitives; all nine actual DO classes, D1 and retained R2 bytes; normal requests held; full repository recovery acceptance remains separate"
        : "isolated full app on Cloudflare; real DO/D1/R2; actual private Git graph",
    productionResourcesUsed: purpose === "vault-recovery",
    productionApplicationResourcesUsed: false,
    sharedAccountSecretsStoreUsed: purpose === "vault-recovery",
    resources: {
      apiName: plan.apiName,
      gateName: plan.gateName,
      bucket: plan.bucket,
      database: plan.database,
      ...(plan.vaultName
        ? {
            vaultName: plan.vaultName,
            providerSecretName: plan.providerSecretName,
          }
        : {}),
    },
    cleanupNeeded: true,
    steps: [],
  };
  assert.deepEqual(record.resources, {
    apiName: plan.apiName,
    gateName: plan.gateName,
    bucket: plan.bucket,
    database: plan.database,
    ...(plan.vaultName
      ? {
          vaultName: plan.vaultName,
          providerSecretName: plan.providerSecretName,
        }
      : {}),
  });
  assert.equal(record.accountId, accountId);
  assert.equal(record.runId, runId);
  const persist = () => atomic(join(directory, "operation.json"), record);
  if (cleanupDirectory) {
    record.cleanupReconciliations ??= [];
    record.cleanupReconciliations.push({
      at: new Date().toISOString(),
      controllerCommit: (
        await exec("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim(),
      providerRuntime,
      previouslyReportedClean: record.cleanupNeeded === false,
    });
    record.cleanupNeeded = true;
  }
  let interrupted = false,
    cleaning = false,
    activeCli;
  const interrupt = () => {
    interrupted = true;
    if (activeCli?.pid) {
      try {
        process.kill(-activeCli.pid, "SIGTERM");
      } catch {}
    }
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const configPaths = {
    api: join(directory, "api.json"),
    gate: join(directory, "gate.json"),
    retired: join(directory, "retired.json"),
    purge: join(directory, "purge.json"),
    vault: join(directory, "vault.json"),
    vaultRetired: join(directory, "vault-retired.json"),
  };
  if (!cleanupDirectory)
    await atomic(join(directory, "manifest.json"), {
      format: 1,
      purpose,
      root,
      accountId,
      runId,
      deadline,
      resources: record.resources,
    });
  await persist();
  const saveConfigs = async () => {
    await atomic(configPaths.api, plan.api);
    await atomic(configPaths.gate, plan.gate);
    await atomic(configPaths.retired, plan.retired);
    await atomic(configPaths.purge, purgeConfiguration(plan));
    if (plan.vault) {
      await atomic(configPaths.vault, plan.vault);
      await atomic(configPaths.vaultRetired, plan.vaultRetired);
    }
  };
  await saveConfigs();
  const wranglerOnce = async (
    args,
    config = configPaths.api,
    { allowFailure = false } = {},
  ) => {
    if (interrupted && !cleaning)
      throw Error("Interrupted; completing fixture cleanup");
    const name =
      String(++step).padStart(3, "0") +
      "-" +
      args
        .slice(0, 2)
        .join("-")
        .replace(/[^a-z0-9-]/gi, "_");
    let result;
    try {
      const answer = await exec(
        "bun",
        wranglerArguments([...args, "--config", config], providerRuntime),
        {
          cwd: join(root, "apps/web"),
          env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
          timeout:
            args[0] === "deploy"
              ? 8 * 60000
              : isProviderObservation(args)
                ? 30000
                : 3 * 60000,
          maxBuffer: 16 << 20,
        },
      );
      result = { code: 0, stdout: answer.stdout, stderr: answer.stderr };
    } catch (error) {
      result = {
        code: typeof error.code === "number" ? error.code : 1,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
        executionUncertain: error.killed === true || Boolean(error.signal) ||
          error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        timedOut:
          isProviderObservation(args) &&
          error.killed === true &&
          error.signal === "SIGTERM" &&
          error.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      };
      if (result.timedOut)
        result.stderr += "\nProvider observation exceeded local timeout\n";
    }
    await writeFile(
      join(directory, name + ".log"),
      result.stdout + "\n" + result.stderr,
      { mode: 0o600 },
    );
    record.steps.push({ step: name, code: result.code, providerRuntime });
    await persist();
    if (result.code && !allowFailure)
      throw Error(
        "Cloudflare operation failed: " + name + "; inspect its private log",
      );
    return { ...result, step: name };
  };
  const wrangler = async (
    args,
    config = configPaths.api,
    { allowFailure = false } = {},
  ) => {
    const result = await observeWithRetries(args, () =>
      wranglerOnce(args, config, { allowFailure: true }),
    );
    if (result.code && !allowFailure)
      throw Error(
        "Cloudflare operation failed: " +
          record.steps.at(-1).step +
          "; inspect its private log",
      );
    return result;
  };
  const deploy = async (config) => {
    const result = await wrangler(["deploy"], config),
      version = /Current Version ID:\s*([a-f0-9-]{36})/.exec(
        result.stdout,
      )?.[1];
    if (!version) throw Error("Deployment version not confirmed");
    return { version, output: result.stdout };
  };
  const metadata = async (version, config) =>
    JSON.parse(
      (await wrangler(["versions", "view", version, "--json"], config)).stdout,
    );
  const currentVersion = async (config) => {
    const value = JSON.parse(
      (await wrangler(["deployments", "status", "--json"], config)).stdout,
    );
    assert.equal(
      value.versions?.length,
      1,
      "Fixture must have one active version",
    );
    assert.equal(value.versions[0].percentage, 100);
    assert.match(value.versions[0].version_id, /^[a-f0-9-]{36}$/);
    return value.versions[0].version_id;
  };
  const ownedOrigin = (output) => {
    const origin = new RegExp(
      "https://" + plan.gateName + "\\.[a-z0-9-]+\\.workers\\.dev",
    ).exec(output)?.[0];
    if (!origin) throw Error("Owned gate URL not confirmed");
    return origin;
  };
  const call = async (
    path,
    { method = "GET", body, cookie = false, expectedStatus, timeoutMs = 120000 } = {},
  ) => {
    const response = await fetch(gateOrigin + path, {
      method,
      headers: {
        "x-nanohub-hosted-fixture": keys.control,
        ...(cookie ? { Cookie: ownerCookie, Origin: gateOrigin } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (
      expectedStatus === undefined
        ? !response.ok
        : response.status !== expectedStatus
    )
      throw Error(`Fixture HTTP ${response.status} at ${path.split("?")[0]}`);
    return response;
  };
  const cli = async (args, { input = "", label = "cli" } = {}) => {
    const stdout = [],
      stderr = [];
    const child = spawn(
      "bun",
      [
        join(directory, "nh.mjs"),
        ...args,
        "--host",
        record.proxyOrigin,
        "-R",
        "hosted-fixture/meld-copy",
        "--credential-helper",
        "cache",
        "--json",
      ],
      {
        cwd: directory,
        env: clientEnv,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    activeCli = child;
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }, 35 * 60000);
    child.stdout.on("data", (value) => stdout.push(value));
    child.stderr.on("data", (value) => {
      stderr.push(value);
      const message = String(value).trim();
      if (label === "import" && message.includes("publishing atomic refs"))
        record.refPublicationStartedAt = new Date().toISOString();
      if (label === "import" && message.includes("verifying independent clone"))
        record.cloneVerificationStartedAt = new Date().toISOString();
      if (
        /^(Imported \d+\/\d+ objects|publishing atomic refs|verifying independent clone)$/.test(
          message,
        )
      )
        console.log(message);
    });
    child.stdin.end(input);
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    }).finally(() => {
      clearTimeout(timer);
      activeCli = undefined;
    });
    const out = Buffer.concat(stdout).toString(),
      err = Buffer.concat(stderr).toString();
    assert.ok(
      !out.includes(gitToken) && !err.includes(gitToken),
      "CLI must not emit its Git credential",
    );
    await writeFile(join(directory, label + "-stdout.log"), out, {
      mode: 0o600,
    });
    await writeFile(join(directory, label + "-stderr.log"), err, {
      mode: 0o600,
    });
    let data;
    try {
      data = JSON.parse(out);
    } catch {}
    return { code, data };
  };
  try {
    if (!cleanupDirectory) {
      console.log(JSON.stringify({ runId, phase: "preflight" }));
      record.implementationCommit = (
        await exec("git", ["rev-parse", "HEAD"], { cwd: root })
      ).stdout.trim();
      if (purpose === "git-import") {
        const sourceEnv = {
          PATH: process.env.PATH,
          HOME: directory,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        };
        const git = async (...args) =>
          (
            await exec("git", ["-C", source, ...args], {
              env: sourceEnv,
              maxBuffer: 8 << 20,
            })
          ).stdout;
        assert.equal(
          (await git("rev-parse", "--is-shallow-repository")).trim(),
          "false",
        );
        await git("fsck", "--strict");
        const refs = await git(
          "for-each-ref",
          "--format=%(objectname) %(refname)",
          "refs/heads",
          "refs/tags",
        );
        record.source = {
          refs: refs.trim().split("\n").length,
          refsSha256: hash(refs),
        };
        const assets = join(root, "apps/web/.open-next/assets"),
          manifest = JSON.parse(
            await readFile(join(assets, "nh/latest.json"), "utf8"),
          ),
          bytes = await readFile(assets + manifest.path);
        assert.equal(hash(bytes), manifest.sha256);
        record.cli = manifest;
        await writeFile(join(directory, "nh.mjs"), bytes, { mode: 0o600 });
      }
      await persist();
      // Compile both wrappers before any provider resource is created.
      await wrangler([
        "deploy",
        "--dry-run",
        "--outdir",
        join(directory, "dry-api"),
      ]);
      await wrangler(
        ["deploy", "--dry-run", "--outdir", join(directory, "dry-gate")],
        configPaths.gate,
      );
      if (plan.vault)
        await wrangler(
          ["deploy", "--dry-run", "--outdir", join(directory, "dry-vault")],
          configPaths.vault,
        );
      record.d1Requested = true;
      await persist();
      const database = await wrangler([
        "d1",
        "create",
        plan.database,
        "--update-config=false",
      ]);
      const databaseId =
        /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/.exec(
          database.stdout,
        )?.[0];
      if (!databaseId) throw Error("New D1 identifier not confirmed");
      record.databaseId = databaseId;
      plan = fixturePlan({
        root,
        accountId,
        runId,
        deadline,
        databaseId,
        purpose,
      });
      await saveConfigs();
      record.bucketRequested = true;
      await persist();
      await wrangler(
        ["r2", "bucket", "create", plan.bucket, "--update-config=false"],
        configPaths.gate,
      );
      if (plan.vault) {
        const stores = metadataRows(
          await wrangler(
            ["secrets-store", "store", "list", "--remote", "--per-page", "100"],
            configPaths.purge,
          ),
        );
        assert.equal(
          stores.length,
          1,
          "Use the existing account store without creating or deleting it",
        );
        assert.equal(stores[0].AccountID, accountId);
        record.storeId = stores[0].ID;
        await persist();
        plan = fixturePlan({
          root,
          accountId,
          runId,
          deadline,
          databaseId,
          purpose,
          storeId: record.storeId,
        });
        await saveConfigs();
        const original = await listProviderSecrets(
          plan,
          wrangler,
          configPaths.purge,
        );
        assert.ok(!original.some((x) => x.Name === plan.providerSecretName));
        record.otherProviderSecretIds = original.map(({ ID, Name }) => ({
          id: ID,
          name: Name,
        }));
        record.providerSecretRequested = true;
        await persist();
        const created = await wrangler(
          [
            "secrets-store",
            "secret",
            "create",
            plan.storeId,
            "--name",
            plan.providerSecretName,
            "--scopes",
            "workers",
            "--value",
            syntheticValue(plan, "A"),
            "--remote",
          ],
          configPaths.purge,
        );
        const id = /Created secret! \(ID: ([a-f0-9]{32})\)/.exec(
          created.stdout,
        )?.[1];
        assert.ok(id, "Owned provider secret creation must be acknowledged");
        record.providerSecretId = id;
        await persist();
        assert.equal(
          ownedSecret(
            await listProviderSecrets(plan, wrangler, configPaths.purge),
            plan,
            record,
          )?.ID,
          id,
        );
        record.vaultRequested = true;
        await persist();
        const deployed = await deploy(configPaths.vault);
        record.vaultVersion = deployed.version;
        await persist();
        const path = join(directory, "vault-secrets.json");
        await atomic(path, { HOSTED_BACKEND_KEY: keys.backend });
        await wrangler(["secret", "bulk", path], configPaths.vault);
        await rm(path);
        record.vaultVersion = await currentVersion(configPaths.vault);
        const meta = await metadata(record.vaultVersion, configPaths.vault);
        assertVaultBindings(meta, plan);
        await atomic(join(directory, "vault-version.json"), meta);
        record.vaultBindingsIsolated = true;
        await persist();
      }
      record.apiRequested = true;
      await persist();
      const apiDeploy = await deploy(configPaths.api);
      record.apiVersion = apiDeploy.version;
      const apiSecrets = join(directory, "api-secrets.json");
      await atomic(apiSecrets, {
        HOSTED_BACKEND_KEY: keys.backend,
        SESSION_SECRET: keys.session,
      });
      await wrangler(["secret", "bulk", apiSecrets]);
      await rm(apiSecrets);
      record.gateRequested = true;
      await persist();
      const gateDeploy = await deploy(configPaths.gate);
      record.gateVersion = gateDeploy.version;
      gateOrigin = ownedOrigin(gateDeploy.output);
      record.gateOrigin = gateOrigin;
      const gateSecrets = join(directory, "gate-secrets.json");
      await atomic(gateSecrets, {
        HOSTED_FIXTURE_KEY: keys.control,
        HOSTED_BACKEND_KEY: keys.backend,
      });
      await wrangler(["secret", "bulk", gateSecrets], configPaths.gate);
      await rm(gateSecrets);
      // Secret uploads deploy a new version; query the explicit resource binding
      // graph again, rather than assuming the pre-secret version is still live.
      record.apiVersion = await currentVersion(configPaths.api);
      record.gateVersion = await currentVersion(configPaths.gate);
      const apiMetadata = await metadata(record.apiVersion, configPaths.api),
        gateMetadata = await metadata(record.gateVersion, configPaths.gate);
      assertFixtureBindings(apiMetadata, plan, "api");
      assertFixtureBindings(gateMetadata, plan, "gate");
      await atomic(join(directory, "api-version.json"), apiMetadata);
      await atomic(join(directory, "gate-version.json"), gateMetadata);
      record.bindingsIsolated = true;
      trace = await startTrace({ root, config: configPaths.api, directory });
      assert.equal(
        (await fetch(gateOrigin + "/api/agent-help", { redirect: "error" }))
          .status,
        404,
      );
      const health = await (await call("/__fixture/health")).json();
      assert.equal(health.fixture, "private-hosted-git");
      if (["repository-recovery", "vault-recovery"].includes(purpose)) {
        const { runRepositoryRecoveryProbe } =
          await import("./hosted-recovery-fixture/repository-probe.mjs");
        const observePhase = (phase) => waitForFixturePhase(
          async (timeoutMs) => (await call("/__fixture/repository", {
            method: "POST", body: { op: "phase" }, timeoutMs,
          })).json(),
          { phase, version: record.apiVersion },
        );
        record.recoverySeedObservation = await observePhase("seed");
        await persist();
        const setPhase = async (phase) => {
          assert.ok(["seed", "frozen", "verify", "reconcile"].includes(phase));
          const observeDeployment = async () => {
            const version = await currentVersion(configPaths.api);
            const state = await metadata(version, configPaths.api);
            assert.equal(await currentVersion(configPaths.api), version,
              "Fixture deployment changed during observation");
            return { version, metadata: state };
          };
          const previous = await observeDeployment();
          assert.equal(previous.version, record.apiVersion);
          assertFixtureBindings(previous.metadata, plan, "api");
          const previousPhase = plan.api.vars.HOSTED_REPO_PHASE;
          plan.api.vars.HOSTED_REPO_PHASE = phase;
          await saveConfigs();
          const deployed = await deployHeldFixturePhase({
            accountId, runId, purpose, worker: plan.apiName, phase, previousPhase, previous,
            deployOnce: () => wrangler(["deploy"], configPaths.api, { allowFailure: true }),
            observe: observeDeployment,
            recordRetry: async (proof) => {
              record.recoveryPhaseDeployRetries ??= [];
              record.recoveryPhaseDeployRetries.push({ ...proof, at: new Date().toISOString() });
              await persist();
            },
          });
          record.apiVersion = deployed.version;
          assertFixtureBindings(deployed.metadata, plan, "api");
          const observed = await observePhase(phase);
          record.recoveryPhases ??= [];
          record.recoveryPhases.push({
            phase,
            version: record.apiVersion,
            deployAttempts: deployed.attempts,
            dataPlaneObservation: observed,
            at: new Date().toISOString(),
          });
          await persist();
        };
        await runRepositoryRecoveryProbe({
          call,
          wrangler,
          config: configPaths.purge,
          plan,
          record,
          persist,
          directory,
          setPhase,
          origin: gateOrigin,
          controlKey: keys.control,
          rotateProviderSecret: plan.vault
            ? async () => {
                assert.equal(
                  ownedSecret(
                    await listProviderSecrets(
                      plan,
                      wrangler,
                      configPaths.purge,
                    ),
                    plan,
                    record,
                  )?.ID,
                  record.providerSecretId,
                );
                await wrangler(
                  [
                    "secrets-store",
                    "secret",
                    "update",
                    plan.storeId,
                    "--secret-id",
                    record.providerSecretId,
                    "--value",
                    syntheticValue(plan, "B"),
                    "--remote",
                  ],
                  configPaths.purge,
                );
                assert.equal(
                  await currentVersion(configPaths.vault),
                  record.vaultVersion,
                );
                record.vaultRotationWithoutRedeploy = true;
                await persist();
              }
            : undefined,
        });
        record.acceptancePassed = true;
      } else if (purpose === "storage-recovery") {
        const { runNativeRecoveryProbe } =
          await import("./hosted-recovery-fixture/probe.mjs");
        await runNativeRecoveryProbe({
          call,
          wrangler,
          config: configPaths.purge,
          plan,
          record,
          persist,
          directory,
        });
        record.acceptancePassed = true;
      } else {
        const sourceEnv = {
          PATH: process.env.PATH,
          HOME: directory,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
        };
        const git = async (...args) =>
          (
            await exec("git", ["-C", source, ...args], {
              env: sourceEnv,
              maxBuffer: 8 << 20,
            })
          ).stdout;
        const session = await call("/__fixture/session", {
          method: "POST",
          body: {},
        });
        ownerCookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
        if (!ownerCookie)
          throw Error("Synthetic fixture session not confirmed");
        await call("/api/namespaces", {
          method: "POST",
          body: { name: "hosted-fixture" },
          cookie: true,
        });
        const repo = await (
          await call("/api/repos/hosted-fixture/meld-copy", {
            method: "POST",
            body: {},
            cookie: true,
          })
        ).json();
        record.repositoryId = repo.id;
        const issued = await (
          await call("/api/repos/hosted-fixture/meld-copy/git-tokens", {
            method: "POST",
            body: { label: "Hosted acceptance; destroyed after verification" },
            cookie: true,
          })
        ).json();
        gitToken = issued.token;
        record.gitCredentialId = issued.id;
        const authorization =
          "Basic " + Buffer.from("git:" + gitToken).toString("base64");
        proxy = await gitProxy({
          origin: gateOrigin,
          authorization,
          control: keys.control,
          repositoryPath: "/git/hosted-fixture/meld-copy.git",
        });
        record.proxyOrigin = proxy.origin;
        const home = join(directory, "client-home");
        await mkdir(home, { mode: 0o700 });
        clientEnv = {
          PATH: process.env.PATH,
          HOME: home,
          XDG_CACHE_HOME: join(home, "cache"),
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_TERMINAL_PROMPT: "0",
          NANOHUB_API_TOKEN: "",
        };
        assert.equal(
          (
            await cli(["auth", "login", "--with-token"], {
              input: gitToken + "\n",
              label: "login",
            })
          ).code,
          0,
        );
        record.importStartedAt = new Date().toISOString();
        await persist();
        const imported = await cli(["repo", "import", source, "--git"], {
          label: "import",
        });
        record.importExitCode = imported.code;
        await persist();
        assert.equal(
          imported.code,
          0,
          "Hosted import failed; inspect private import logs",
        );
        assert.equal(imported.data.verified, true);
        assert.equal(imported.data.refs, record.source.refs);
        record.import = imported.data;
        record.importRequests = proxy.traffic();
        assert.equal(record.importRequests.refPublications, 1);
        assert.ok(record.importRequests.objectUploads > 0);
        const before = await (
          await call("/api/repos/hosted-fixture/meld-copy/repository", {
            cookie: true,
          })
        ).json();
        const resumed = await cli(["repo", "import", source, "--git"], {
          label: "resume",
        });
        assert.equal(resumed.code, 0);
        assert.equal(resumed.data.resumed, true);
        assert.equal(resumed.data.uploadedObjects, 0);
        assert.deepEqual(
          proxy.traffic(),
          record.importRequests,
          "Resume must send no object uploads or ref publications",
        );
        record.verificationOnlyResume = true;
        const after = await (
          await call("/api/repos/hosted-fixture/meld-copy/repository", {
            cookie: true,
          })
        ).json();
        assert.deepEqual(after.refs, before.refs);
        assert.deepEqual(
          await (
            await call("/api/repos/hosted-fixture/meld-copy/agents", {
              cookie: true,
            })
          ).json(),
          [],
        );
        record.registeredAgents = 0;
        assert.equal(
          hash(
            await git(
              "for-each-ref",
              "--format=%(objectname) %(refname)",
              "refs/heads",
              "refs/tags",
            ),
          ),
          record.source.refsSha256,
        );
        record.sourceUnchanged = true;
        await call("/api/tokens/" + issued.id, {
          method: "DELETE",
          cookie: true,
        });
        const revoked = await cli(["repo", "import", source, "--git"], {
          label: "revoked",
        });
        assert.notEqual(revoked.code, 0);
        assert.match(revoked.data?.error ?? "", /discovery failed \(401\)/i);
        record.revocationDenies = true;
        record.acceptancePassed = true;
      }
    }
  } catch (error) {
    record.error = String(error.message);
    throw error;
  } finally {
    cleaning = true;
    if (trace)
      record.runtimeTrace = await trace.close().catch(() => ({ failed: true }));
    if (proxy) await proxy.close();
    if (clientEnv)
      await exec("git", ["credential-cache", "exit"], { env: clientEnv }).catch(
        () => {},
      );
    const exists = async (kind) => {
      if (kind === "api" || kind === "gate" || kind === "vault") {
        const result = await wrangler(
          ["versions", "list", "--json"],
          kind === "api"
            ? configPaths.retired
            : kind === "vault"
              ? configPaths.vaultRetired
              : configPaths.purge,
          { allowFailure: true },
        );
        if (result.code) {
          if (/\b10007\b/.test(result.stdout + result.stderr)) return false;
          throw Error("Worker existence could not be confirmed");
        }
        assert.ok(Array.isArray(JSON.parse(result.stdout)));
        return true;
      }
      if (kind === "providerSecret")
        return record.storeId
          ? !!ownedSecret(
              await listProviderSecrets(plan, wrangler, configPaths.purge),
              plan,
              record,
            )
          : false;
      if (kind === "bucket")
        return bucketExists(
          await wrangler(
            ["r2", "bucket", "info", plan.bucket],
            configPaths.purge,
            { allowFailure: true },
          ),
          plan.bucket,
        );
      const list = JSON.parse(
        (await wrangler(["d1", "list", "--json"], configPaths.purge)).stdout,
      );
      assert.ok(Array.isArray(list));
      return list.some((item) => item.name === plan.database);
    };
    await cleanupFixture(record, {
      persist,
      exists,
      ...(plan.vault
        ? {
            extraKinds: ["vault", "providerSecret"],
            cleanupVault: async (observed) => {
              if (observed.vault) {
                await deploy(configPaths.vaultRetired);
                const retired = await metadata(
                  await currentVersion(configPaths.vaultRetired),
                  configPaths.vaultRetired,
                );
                assert.equal(
                  retired.resources.script_runtime.migration_tag,
                  "fixture-vault-retired",
                );
                assert.ok(
                  !retired.resources.bindings.some(
                    (x) =>
                      x.type === "durable_object_namespace" ||
                      x.type === "secrets_store_secret",
                  ),
                );
                await atomic(
                  join(directory, "retired-vault-version.json"),
                  retired,
                );
                record.vaultNamespacesRetired = true;
                await persist();
                await wrangler(
                  ["delete", plan.vaultName, "--force"],
                  configPaths.vaultRetired,
                );
                assert.equal(await exists("vault"), false);
              } else if (record.vaultVersion && !record.vaultNamespacesRetired)
                throw Error("Vault missing without namespace retirement proof");
              record.vaultWorkerDeleted = true;
              await persist();
              if (observed.providerSecret) {
                const target = ownedSecret(
                  await listProviderSecrets(plan, wrangler, configPaths.purge),
                  plan,
                  record,
                );
                assert.ok(target);
                await wrangler(
                  [
                    "secrets-store",
                    "secret",
                    "delete",
                    plan.storeId,
                    "--secret-id",
                    target.ID,
                    "--remote",
                  ],
                  configPaths.purge,
                );
              }
              assert.equal(await exists("providerSecret"), false);
              record.providerSecretDeleted = true;
              if (record.storeId) {
                const remaining = await listProviderSecrets(
                  plan,
                  wrangler,
                  configPaths.purge,
                );
                for (const entry of record.otherProviderSecretIds ?? [])
                  assert.ok(
                    remaining.some(
                      (x) => x.ID === entry.id && x.Name === entry.name,
                    ),
                    "An existing provider secret is missing",
                  );
                record.existingProviderEntriesRetained = true;
              }
              await persist();
            },
          }
        : {}),
      closeGate: async (observed) => {
        record.gateRequested = true;
        await persist();
        const fenceConfig = observed.bucket
          ? configPaths.purge
          : join(directory, "detached-purge.json");
        if (!observed.bucket)
          await atomic(
            fenceConfig,
            purgeConfiguration(plan, { bucketPresent: false }),
          );
        const value = await deploy(fenceConfig);
        gateOrigin = ownedOrigin(value.output);
        record.gateOrigin = gateOrigin;
        const path = join(directory, "gate-secrets.json");
        await atomic(path, {
          HOSTED_FIXTURE_KEY: keys.control,
          HOSTED_BACKEND_KEY: keys.backend,
        });
        await wrangler(["secret", "bulk", path], fenceConfig);
        await rm(path);
        const fenced = await metadata(
          await currentVersion(fenceConfig),
          fenceConfig,
        );
        assert.ok(
          !fenced.resources.bindings.some(
            (binding) => binding.type === "service",
          ),
        );
        assert.equal(
          fenced.resources.bindings.find(
            (binding) => binding.name === "OBJECTS",
          )?.bucket_name,
          observed.bucket ? plan.bucket : undefined,
        );
        assert.equal(
          fenced.resources.bindings.filter(
            (binding) => binding.type === "r2_bucket",
          ).length,
          observed.bucket ? 1 : 0,
        );
        assert.equal(
          fenced.resources.bindings.find(
            (binding) => binding.name === "HOSTED_PURGE_ONLY",
          )?.text,
          "1",
        );
        await atomic(join(directory, "fenced-version.json"), fenced);
        record.gateBucketBindingDetached = !observed.bucket;
      },
      retire: async () => {
        await deploy(configPaths.retired);
        const retired = await metadata(
          await currentVersion(configPaths.retired),
          configPaths.retired,
        );
        assert.equal(
          retired.resources.script_runtime.migration_tag,
          "fixture-retired",
        );
        assert.equal(
          retired.resources.bindings.filter(
            (binding) => binding.type === "durable_object_namespace",
          ).length,
          0,
        );
        await atomic(join(directory, "retired-version.json"), retired);
      },
      purge: async () => {
        let empty = 0,
          deleted = 0;
        for (let page = 0; page < 10000 && empty < 2; page++) {
          const send = (path, method, timeoutMs) => fetch(gateOrigin + path, {
            method, headers: { "x-nanohub-hosted-fixture": keys.control },
            redirect: "error", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
          });
          const value = await purgeFixturePage({
            readStatus: (timeoutMs) => send("/__fixture/purge-status", "GET", timeoutMs),
            purge: (timeoutMs) => send("/__fixture/purge", "POST", timeoutMs),
            recordObservation: async (proof) => {
              record.cleanupPurgeObservations ??= [];
              record.cleanupPurgeObservations.push({ ...proof, page, at: new Date().toISOString() });
              await persist();
            },
          });
          assert.ok(
            Number.isInteger(value.deleted) &&
              value.deleted >= 0 &&
              value.deleted <= 1000,
          );
          deleted += value.deleted;
          empty = value.deleted ? 0 : empty + 1;
          if (!value.deleted) await wait(1500);
        }
        assert.equal(empty, 2);
        record.deletedObjectCount = deleted;
      },
      delete: async (kind) => {
        if (kind === "api")
          await wrangler(
            ["delete", plan.apiName, "--force"],
            configPaths.retired,
          );
        else if (kind === "gate")
          await wrangler(
            ["delete", plan.gateName, "--force"],
            configPaths.purge,
          );
        else if (kind === "bucket")
          await wrangler(
            ["r2", "bucket", "delete", plan.bucket],
            configPaths.purge,
          );
        else if (kind === "database")
          await wrangler(
            ["d1", "delete", plan.database, "--skip-confirmation"],
            configPaths.purge,
          );
        else throw Error("Unknown resource kind");
      },
      removeKeys: async () => {
        for (const file of [
          "private-keys.json",
          "api-secrets.json",
          "gate-secrets.json",
          "repository-private-grants.json",
          "vault-secrets.json",
        ])
          await rm(join(directory, file), { force: true });
      },
    });
    console.log(
      JSON.stringify({
        runId,
        acceptancePassed: record.acceptancePassed ?? false,
        cleanupNeeded: record.cleanupNeeded,
        cleanupErrors: record.cleanupErrors.map((error) => error.stage),
      }),
    );
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    if (record.cleanupNeeded)
      throw Error(
        "Fixture cleanup incomplete; rerun --cleanup with the private receipt directory",
      );
  }
  return { directory, record };
}
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--cleanup") {
    assert.equal(args.length, 2);
    await verifyHostedGitImport(undefined, undefined, undefined, args[1]);
  } else {
    assert.equal(args.length, 3);
    await verifyHostedGitImport(...args);
  }
}
