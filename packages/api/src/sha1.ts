/** SHA-1 in plain JavaScript, for the small objects a landing hashes (a blob,
 *  the trees on its path, a commit). In the Workers runtime, setting up a
 *  node:crypto hash costs far more than hashing a few hundred bytes, and the
 *  sequencer, which cannot run in parallel, hashes several per landing.
 *  Checked against node:crypto by scripts/check-sha1.ts. */

const W = new Int32Array(80);

export function sha1Hex(data: Uint8Array): string {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89 | 0;
  let h2 = 0x98badcfe | 0;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0 | 0;
  const n = data.length;
  // Padding: a 1 bit, zeros, then the length in bits in the last 8 bytes.
  const blocks = ((n + 8) >>> 6) + 1;
  for (let b = 0; b < blocks; b++) {
    const base = b * 64;
    for (let i = 0; i < 16; i++) {
      const k = base + i * 4;
      if (k + 3 < n) {
        W[i] = (data[k] << 24) | (data[k + 1] << 16) | (data[k + 2] << 8) | data[k + 3];
      } else {
        let w = 0;
        for (let j = 0; j < 4; j++) w = (w << 8) | (k + j < n ? data[k + j] : k + j === n ? 0x80 : 0);
        W[i] = w;
      }
    }
    if (b === blocks - 1) {
      const bits = n * 8;
      W[14] = Math.floor(bits / 0x100000000) | 0;
      W[15] = bits | 0;
    }
    for (let i = 16; i < 80; i++) {
      const x = W[i - 3] ^ W[i - 8] ^ W[i - 14] ^ W[i - 16];
      W[i] = (x << 1) | (x >>> 31);
    }
    let a = h0;
    let bb = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (bb & c) | (~bb & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = bb ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (bb & c) | (bb & d) | (c & d);
        k = 0x8f1bbcdc | 0;
      } else {
        f = bb ^ c ^ d;
        k = 0xca62c1d6 | 0;
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + W[i]) | 0;
      e = d;
      d = c;
      c = (bb << 30) | (bb >>> 2);
      bb = a;
      a = t;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + bb) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4);
}

const hex = (x: number) => (x >>> 0).toString(16).padStart(8, "0");
