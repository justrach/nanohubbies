// The plain-JavaScript SHA-1 the sequencer uses for small objects, checked
// against node:crypto: every length up to 1,100 bytes, which crosses every
// padding boundary many times, and random inputs up to 64 KB.
//   node scripts/check-sha1.ts

import { createHash, randomBytes } from "node:crypto";
import { sha1Hex } from "../src/sha1.ts";

let checked = 0;
let bad = 0;
const check = (data: Uint8Array) => {
  checked++;
  if (sha1Hex(data) !== createHash("sha1").update(data).digest("hex")) bad++;
};
for (let n = 0; n <= 1100; n++) {
  check(new Uint8Array(n));
  check(randomBytes(n));
  check(new Uint8Array(n).fill(0xff));
}
for (let i = 0; i < 2000; i++) check(randomBytes(Math.floor(Math.random() * 65536)));
console.log(bad ? `${bad} of ${checked} differ from node:crypto` : `${checked} inputs match node:crypto`);
process.exit(bad ? 1 : 0);
