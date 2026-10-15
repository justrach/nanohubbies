/** The server half of git's smart-HTTP push (receive-pack, protocol v1):
 *  the ref advertisement, the request, and the status report. Lines sent on
 *  side-band 2 are what git prints as "remote: ...". */

export const ZERO = "0".repeat(40);
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();
const FLUSH = utf8.encode("0000");
const CAPS = "report-status side-band-64k no-thin ofs-delta delete-refs quiet agent=nanohub-swarm";

export interface Command {
  old: string;
  new: string;
  ref: string;
}

/** What `git push` sees first. Main is not advertised as a ref: git would
 *  refuse to push onto a main it has not fetched ("fetch first"), and here the
 *  trunk decides what lands. Its recent commits go out as `.have` lines
 *  instead, so the client still sends only the objects that are new. */
export function advertise(haves: string[], branches = ""): Response {
  const refs = branches.trim().split("\n").filter((b) => b && !b.endsWith("\trefs/heads/main")).map((b) => b.replace("\t", " "));
  const lines = [...refs, ...haves.map((sha) => `${sha} .have`)];
  if (!lines.length) lines.push(`${ZERO} capabilities^{}`);
  const body = concat([pkt("# service=git-receive-pack\n"), FLUSH, ...lines.map((l, i) => pkt(i === 0 ? `${l}\0${CAPS}\n` : `${l}\n`)), FLUSH]);
  return new Response(body, { headers: { "content-type": "application/x-git-receive-pack-advertisement", "cache-control": "no-cache" } });
}

/** The ref updates and the packfile after them. */
export function readRequest(body: Uint8Array): { commands: Command[]; caps: Set<string>; pack: Uint8Array } {
  const commands: Command[] = [];
  let caps = new Set<string>();
  let i = 0;
  while (i + 4 <= body.length) {
    const len = parseInt(fromUtf8.decode(body.subarray(i, i + 4)), 16);
    if (Number.isNaN(len)) throw new Error("malformed push request");
    i += Math.max(len, 4);
    if (len < 4) break; // flush: the commands end here
    let line = fromUtf8.decode(body.subarray(i - len + 4, i)).replace(/\n$/, "");
    const nul = line.indexOf("\0");
    if (nul >= 0) {
      caps = new Set(line.slice(nul + 1).trim().split(" "));
      line = line.slice(0, nul);
    }
    const [old, neu, ref] = line.split(" ");
    if (!/^[0-9a-f]{40}$/.test(old) || !/^[0-9a-f]{40}$/.test(neu) || !ref) throw new Error("malformed push command");
    commands.push({ old, new: neu, ref });
  }
  return { commands, caps, pack: body.subarray(i) };
}

export interface RefStatus {
  ref: string;
  /** null when the update landed; otherwise why not, in a few words. */
  refused: string | null;
}

/** The report git prints: whether the pack unpacked, each ref's fate, and
 *  any messages for the person or agent who pushed. */
export function report(caps: Set<string>, unpackError: string | null, refs: RefStatus[], messages: string[]): Response {
  const status = concat([
    pkt(`unpack ${unpackError ?? "ok"}\n`),
    ...refs.map((r) => pkt(r.refused === null ? `ok ${r.ref}\n` : `ng ${r.ref} ${r.refused.replace(/\n/g, " ")}\n`)),
    FLUSH,
  ]);
  const headers = { "content-type": "application/x-git-receive-pack-result", "cache-control": "no-cache" };
  if (!caps.has("side-band-64k")) return new Response(caps.has("report-status") ? status : new Uint8Array(), { headers });
  const parts: Uint8Array[] = [];
  for (const m of messages) parts.push(band(2, utf8.encode(`${m}\n`)));
  if (caps.has("report-status")) for (let at = 0; at < status.length; at += 65_000) parts.push(band(1, status.subarray(at, at + 65_000)));
  parts.push(FLUSH);
  return new Response(concat(parts), { headers });
}

function band(channel: number, data: Uint8Array): Uint8Array {
  return concat([utf8.encode((data.length + 5).toString(16).padStart(4, "0")), Uint8Array.of(channel), data]);
}

function pkt(line: string): Uint8Array {
  const data = utf8.encode(line);
  return concat([utf8.encode((data.length + 4).toString(16).padStart(4, "0")), data]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
