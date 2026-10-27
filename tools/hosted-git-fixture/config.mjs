import { resolve } from "node:path";
export const classes = [
  ["SEQUENCER", "Sequencer"],
  ["AGENT", "Agent"],
  ["ROOM", "Room"],
  ["DRIVER", "Driver"],
  ["HUB", "Hub"],
  ["IMPORT_JOB", "ImportJob"],
  ["ACCOUNT", "Account"],
  ["LANE", "Lane"],
  ["PACKER", "Packer"],
];
export function fixturePlan({
  root,
  accountId,
  runId,
  deadline,
  databaseId = "00000000-0000-0000-0000-000000000000",
  purpose = "git-import",
}) {
  if (
    !["git-import", "storage-recovery", "repository-recovery"].includes(
      purpose,
    ) ||
    !/^[a-f0-9]{32}$/.test(accountId) ||
    !/^[a-z0-9]{8,12}-[a-f0-9]{10}$/.test(runId) ||
    !Number.isSafeInteger(deadline) ||
    deadline <= 0 ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      databaseId,
    )
  )
    throw Error("Invalid isolated fixture identity");
  const prefix =
      (purpose === "repository-recovery"
        ? "nh-repo-recovery-"
        : purpose === "storage-recovery"
          ? "nh-recovery-live-"
          : "nh-git-live-") + runId,
    apiName = prefix + "-app",
    gateName = prefix + "-gate",
    bucket = prefix + "-objects",
    database = prefix + "-auth";
  const common = {
    account_id: accountId,
    compatibility_date: "2026-09-01",
    compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"],
    limits: { subrequests: 50000 },
    version_metadata: { binding: "CF_VERSION_METADATA" },
  };
  const initial = {
    tag: "fixture-v1",
    new_sqlite_classes: classes.map(([, name]) => name),
  };
  return {
    accountId,
    purpose,
    runId,
    deadline,
    apiName,
    gateName,
    bucket,
    database,
    databaseId,
    api: {
      ...common,
      name: apiName,
      main: resolve(
        root,
        purpose !== "git-import"
          ? "tools/hosted-recovery-fixture/app.ts"
          : "tools/hosted-git-fixture/app.ts",
      ),
      workers_dev: false,
      vars: {
        DEV_LOGIN: "0",
        HOSTED_FIXTURE_EXPIRES: String(deadline),
        ...(purpose !== "git-import" ? { NANOHUB_RECOVERY_HOLD: "1" } : {}),
      },
      ...(purpose === "repository-recovery"
        ? {
            vars: {
              DEV_LOGIN: "0",
              HOSTED_FIXTURE_EXPIRES: String(deadline),
              NANOHUB_RECOVERY_HOLD: "1",
              HOSTED_REPO_RECOVERY: "1",
              HOSTED_REPO_PHASE: "seed",
            },
          }
        : {}),
      assets: {
        directory: resolve(root, "apps/web/.open-next/assets"),
        binding: "ASSETS",
        run_worker_first: true,
      },
      durable_objects: {
        bindings: classes.map(([name, class_name]) => ({ name, class_name })),
      },
      migrations: [initial],
      r2_buckets: [{ binding: "OBJECTS", bucket_name: bucket }],
      d1_databases: [
        {
          binding: "AUTH_DB",
          database_name: database,
          database_id: databaseId,
        },
      ],
    },
    gate: {
      ...common,
      name: gateName,
      main: resolve(root, "tools/hosted-git-fixture/gate.ts"),
      workers_dev: true,
      vars: {
        HOSTED_FIXTURE_EXPIRES: String(deadline),
        HOSTED_PURGE_ONLY: "0",
      },
      services: [{ binding: "TARGET", service: apiName }],
      r2_buckets: [{ binding: "OBJECTS", bucket_name: bucket }],
    },
    retired: {
      ...common,
      name: apiName,
      main: resolve(root, "tools/hosted-git-fixture/retired.ts"),
      workers_dev: false,
      migrations: [
        initial,
        {
          tag: "fixture-retired",
          deleted_classes: classes.map(([, name]) => name),
        },
      ],
      durable_objects: { bindings: [] },
    },
  };
}
export function purgeConfiguration(plan) {
  const { services, ...gate } = plan.gate;
  return { ...gate, vars: { ...gate.vars, HOSTED_PURGE_ONLY: "1" } };
}
export function assertFixtureBindings(metadata, plan, kind) {
  const bindings = metadata.resources.bindings;
  if (
    !["api", "gate"].includes(kind) ||
    !Array.isArray(bindings) ||
    new Set(bindings.map((binding) => binding.name)).size !== bindings.length
  )
    throw Error("Unexpected fixture metadata");
  const allowed = new Set(
    kind === "api"
      ? [
          "AUTH_DB",
          "OBJECTS",
          "ASSETS",
          "CF_VERSION_METADATA",
          "DEV_LOGIN",
          "HOSTED_FIXTURE_EXPIRES",
          "HOSTED_BACKEND_KEY",
          "SESSION_SECRET",
          ...(plan.purpose !== "git-import" ? ["NANOHUB_RECOVERY_HOLD"] : []),
          ...(plan.purpose === "repository-recovery"
            ? ["HOSTED_REPO_RECOVERY", "HOSTED_REPO_PHASE"]
            : []),
          ...classes.map(([name]) => name),
        ]
      : [
          "OBJECTS",
          "TARGET",
          "CF_VERSION_METADATA",
          "HOSTED_FIXTURE_EXPIRES",
          "HOSTED_PURGE_ONLY",
          "HOSTED_FIXTURE_KEY",
          "HOSTED_BACKEND_KEY",
        ],
  );
  if (bindings.some((binding) => !allowed.has(binding.name)))
    throw Error("Unexpected fixture binding");
  if (
    bindings.find((binding) => binding.name === "OBJECTS")?.bucket_name !==
    plan.bucket
  )
    throw Error("Fixture bucket binding does not match the owned resource");
  const services = bindings.filter((binding) => binding.type === "service");
  if (kind === "api") {
    if (
      plan.purpose !== "git-import" &&
      bindings.find((binding) => binding.name === "NANOHUB_RECOVERY_HOLD")
        ?.text !== "1"
    )
      throw Error(
        "Recovery fixture must hold normal requests throughout the drill",
      );
    if (
      plan.purpose === "repository-recovery" &&
      (bindings.find((b) => b.name === "HOSTED_REPO_RECOVERY")?.text !== "1" ||
        bindings.find((b) => b.name === "HOSTED_REPO_PHASE")?.text !==
          plan.api.vars.HOSTED_REPO_PHASE)
    )
      throw Error("Recovery phase metadata mismatch");
    if (services.length)
      throw Error("Fixture API must have no external service bindings");
    const database = bindings.find((binding) => binding.name === "AUTH_DB");
    if ((database?.database_id ?? database?.id) !== plan.databaseId)
      throw Error("Fixture D1 binding does not match the created database");
    const objects = bindings.filter(
      (binding) => binding.type === "durable_object_namespace",
    );
    if (
      objects.length !== classes.length ||
      objects.some(
        (binding) =>
          !classes.some(
            ([name, className]) =>
              binding.name === name && binding.class_name === className,
          ) ||
          (binding.script_name && binding.script_name !== plan.apiName),
      )
    )
      throw Error("Unexpected Durable Object namespace binding");
  } else if (
    services.length !== 1 ||
    services[0].name !== "TARGET" ||
    services[0].service !== plan.apiName
  )
    throw Error("Fixture gate must target only its owned API Worker");
  if (metadata.resources.script_runtime.limits.subrequests !== 50000)
    throw Error("Fixture must retain the actual subrequest budget");
}
