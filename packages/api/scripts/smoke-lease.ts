// An agent that takes its time, against scripted agents that keep rewriting
// the one function it wants to change. Planned on a tip that moves under it,
// it would conflict forever. It loses twice, the sequencer holds the function
// for it, the scripted agents re-plan around the hold, and it lands.
//
// Needs `npx wrangler dev` running with the development login on.
// SWARM_URL defaults to http://localhost:8787. KEEP=1 keeps the trunk.

import { call, cleanup, session, signIn, sleep } from "./client.ts";

type Change = { agent: string; status: string; overlaps: { key: string; kind: string; by: string }[] };

const trunk = `lease-${Date.now().toString(36)}`;
const cookie = await signIn("dana");
await call("POST", `/api/trunks/${trunk}`, { template: "shop" });
// Every scripted life edits a shared function, and almost all of them pick
// src/cart.js#total, the first target.
await call("POST", `/api/trunks/${trunk}/swarm`, { agents: 150, seconds: 60, shared: 1, skew: 3, think: [300, 900] }, cookie);
await sleep(4000);

const s = session(trunk, "dana-agent", cookie);
let version = 0;
let attempts = 0;
let told = "";
while (!version && attempts < 8) {
  attempts++;
  await s.start();
  const { text } = await s.symbol("src/cart.js", "total");
  // Planning, the way a model would: long enough for the tip to move.
  await sleep(1500);
  const r = await s.submit({
    intent: "Ignore negative quantities in total",
    edits: [{ op: "replace", path: "src/cart.js", symbol: "total", text: text.replace("it.cents * it.qty", "it.cents * Math.max(0, it.qty)") }],
  });
  if (r.status === "landed") version = r.version!;
  else if (r.status === "rejected") throw new Error(r.error);
  else {
    await sleep(600);
    told = (await call<{ body: string }[]>("GET", `/api/trunks/${trunk}/channel?for=dana-agent`)).at(-1)?.body ?? "";
    console.log(`attempt ${attempts}: conflict on ${r.conflicts!.map((c) => c.key).join(", ")}`);
  }
}
await call("DELETE", `/api/trunks/${trunk}/swarm?all=1`, undefined, cookie);
await sleep(1000);

const log = await call<Change[]>("GET", `/api/trunks/${trunk}/log?limit=5000`);
const heldOff = log.filter((c) => c.status === "conflict" && c.overlaps.some((o) => o.kind === "leased" && o.by === "dana-agent")).length;
console.log(version ? `landed as v${version} on attempt ${attempts}` : `did not land in ${attempts} attempts`);
console.log(`the channel told it: ${told || "(nothing)"}`);
console.log(`scripted changes held off while dana-agent held the function: ${heldOff}`);
await cleanup([trunk]);

const ok = !!version && attempts >= 2 && attempts <= 4 && heldOff > 0 && told.includes("held for you");
console.log(ok ? "ok" : "FAILED");
if (!ok) process.exitCode = 1;
