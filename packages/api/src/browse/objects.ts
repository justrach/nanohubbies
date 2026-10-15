import { text, type ObjectType } from "../git";
import { ObjectReader } from "../objects";
import type { Objects } from "../trees";

/** Readers kept across requests in this isolate, for a few trunks: objects
 *  never change, so what one page read serves the next. Each holds a few
 *  megabytes at most (./objects), so only a few are kept. */
const readers = new Map<string, ObjectReader>();
const KEPT = 3;

function readerFor(env: Env, trunk: string): ObjectReader {
  let reader = readers.get(trunk);
  if (reader) readers.delete(trunk);
  // The stub is made per call: a stub is not shared between requests.
  else reader = new ObjectReader(env.OBJECTS, trunk, async () => (await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
  readers.set(trunk, reader);
  if (readers.size > KEPT) readers.delete(readers.keys().next().value!);
  return reader;
}

/** Too much to read for one request. */
export class TooBig extends Error {}

/** A trunk's objects for one request, with a budget: a page that would read
 *  more objects than that says so instead of running long. */
export class TrunkObjects implements Objects {
  private reads = 0;
  private prepared?: Promise<void>;
  private reader: ObjectReader;

  constructor(
    env: Env,
    trunk: string,
    private budget = 4000,
  ) {
    this.reader = readerFor(env, trunk);
  }

  async body(sha: string, type: ObjectType): Promise<Uint8Array> {
    if (++this.reads > this.budget) throw new TooBig(`this needs more than ${this.budget} objects; clone the trunk with git instead`);
    if (!this.reader.held(sha)) await (this.prepared ??= this.reader.prepare());
    const obj = await this.reader.get(sha);
    if (!obj) throw new Error(`missing object ${sha}`);
    if (obj.type !== type) throw new Error(`object ${sha} is a ${obj.type}, not a ${type}`);
    return obj.body;
  }

  /** A blob as text. Trunks hold UTF-8 text files only. */
  async text(sha: string): Promise<string> {
    return text(await this.body(sha, "blob"));
  }
}

/** Runs `fn` over `items`, a few at a time, keeping their order. */
export async function inTurn<T, R>(items: T[], fn: (item: T) => Promise<R>, width = 8): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export interface Signature {
  name: string;
  email: string;
  /** Unix milliseconds. */
  at: number;
}

/** A commit as the trunk wrote it: the agent as author, the change's intent as
 *  the subject, and trailers naming the agent, its person and its issue. A
 *  pushed commit kept as is has the agent's own message instead. */
export interface CommitInfo {
  sha: string;
  tree: string;
  parents: string[];
  author: Signature;
  committer: Signature;
  subject: string;
  /** The message after the subject, without its trailers. */
  body: string;
  trailers: [string, string][];
}

const TRAILER = /^([A-Za-z][\w-]*): (.+)$/;

export function parseCommit(sha: string, raw: Uint8Array): CommitInfo {
  const all = text(raw);
  const split = all.indexOf("\n\n");
  const head = (split < 0 ? all : all.slice(0, split)).split("\n");
  const field = (k: string) => head.filter((l) => l.startsWith(`${k} `)).map((l) => l.slice(k.length + 1));
  const message = split < 0 ? "" : all.slice(split + 2).replace(/\s+$/, "");
  const paragraphs = message.split(/\n{2,}/);
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1].split("\n") : [];
  const trailers = last.length && last.every((l) => TRAILER.test(l)) ? last.map((l) => TRAILER.exec(l)!.slice(1, 3) as [string, string]) : [];
  const kept = trailers.length ? paragraphs.slice(0, -1) : paragraphs;
  const [subject = "", ...rest] = kept.join("\n\n").split("\n");
  return {
    sha,
    tree: field("tree")[0] ?? "",
    parents: field("parent"),
    author: signature(field("author")[0]),
    committer: signature(field("committer")[0]),
    subject,
    body: rest.join("\n").trim(),
    trailers,
  };
}

function signature(line = ""): Signature {
  const m = /^(.*?) <([^>]*)> (\d+)/.exec(line);
  return m ? { name: m[1], email: m[2], at: Number(m[3]) * 1000 } : { name: line, email: "", at: 0 };
}
