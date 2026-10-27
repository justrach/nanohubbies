import { ObjectReader } from "../objects";
import { encode } from "../git";
import { commitAt } from "../review/graph";
import { ZERO, type Command } from "../receive";
import type { Unpacked } from "../unpack";
import { refName } from "./store";
import { newRefName } from "./ref-name";
import { isAncestor, repositoryLimits, validateGraph } from "./validate";
import { repositoryProof } from "./rule-proof";
import { assertRefBatch } from "./ref-batch";

/** Objects become durable before the sequencer compares refs and policies. */
export async function repositoryPush(
  env: Env,
  trunk: string,
  commands: Command[],
  pack: Map<string, Unpacked>,
  actor: string,
  agent?: import("../contributions/types").ContributionAgent,
) {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const snapshot = await seq.repositoryRefs();
  assertRefBatch(
    commands.length,
    !snapshot.length && commands.every((c) => c.old === ZERO && c.new !== ZERO),
  );
  const plan = await seq.graphPlan();
  const limits = repositoryLimits(env);
  let incomingBytes = 0;
  for (const object of pack.values()) incomingBytes += object.body.length;
  const scan = limits.objectBytes <= 16 << 20 && incomingBytes <= 4 << 20;
  const verifySignature = (sha: string, raw: Uint8Array) =>
    env.HUB.get(env.HUB.idFromName("hub")).verifyCommitSignature(
      trunk,
      sha,
      raw,
    );
  if (new Set(commands.map((c) => c.ref)).size !== commands.length)
    throw new Error("Duplicate ref command");
  const reader = new ObjectReader(
    env.OBJECTS,
    trunk,
    async () =>
      (await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs,
    scan,
  );
  // Cache commit topology only. Retaining every historical blob would exhaust
  // Worker memory on repositories whose reachable graph exceeds one push.
  const commits = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof reader.get>>>
  >();
  let cacheBytes = 0;
  const get = async (sha: string) => {
    const obj = pack.get(sha) ?? commits.get(sha) ?? (await reader.get(sha));
    if (
      obj?.type === "commit" &&
      !commits.has(sha) &&
      commits.size < 20_000 &&
      cacheBytes + obj.body.length <= 8 * 1024 * 1024
    ) {
      commits.set(sha, obj);
      cacheBytes += obj.body.length;
    }
    return obj;
  };
  for (const c of commands) {
    refName(c.ref);
    if (c.old === ZERO && c.new !== ZERO) newRefName(c.ref);
    if ((snapshot.find((r) => r.name === c.ref)?.commit ?? ZERO) !== c.old)
      throw new Error("Ref changed; fetch and retry");
  }
  const roots = commands
    .filter((c) => c.new !== ZERO)
    .map((c) => ({
      sha: c.new,
      type: c.ref.startsWith("refs/heads/") ? ("commit" as const) : undefined,
    }));
  // Large incoming packs already occupy memory. Only overlap reads when at
  // most 4 MiB is incoming and each stored object is bounded to 16 MiB.
  const readAhead = scan ? 2 : 1;
  // Concurrent cold reads must share one prepared pack inventory in this request.
  if (roots.length) await reader.prepare();
  await validateGraph(get, roots, limits, readAhead);
  const updates = [];
  for (const c of commands) {
    const next =
      c.new === ZERO
        ? null
        : {
            commit: c.new,
            tree: c.ref.startsWith("refs/heads/")
              ? (
                  await commitAt(
                    { body: async (sha) => (await get(sha))!.body },
                    c.new,
                  )
                ).tree
              : "",
          };
    const ff =
      !next || c.old === ZERO || !c.ref.startsWith("refs/heads/")
        ? false
        : await isAncestor(get, c.old, c.new);
    const proof = next
      ? await repositoryProof(
          get,
          c.old === ZERO ? null : c.old,
          c.new,
          plan,
          c.ref,
          verifySignature,
        )
      : undefined;
    updates.push({
      name: c.ref,
      old: c.old === ZERO ? null : c.old,
      next,
      fastForward: ff,
      actor,
      proof,
    });
  }
  await env.PACKER.get(env.PACKER.idFromName(trunk)).publishGit(
    trunk,
    [...pack.values()].map((o) => encode(o.type, o.body)),
  );
  await seq.updateRepository(updates, agent);
}
