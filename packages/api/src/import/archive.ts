/** Read GitHub's tar stream without buffering binary assets or the whole archive. */
const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 3000;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const SKIP =
  /(^|\/)(node_modules|\.git|dist|build|vendor|coverage|\.next|target)\//;
export interface Imported {
  files: { path: string; text: string }[];
  commit: string | null;
  skipped: number;
  count: number;
  bytes: number;
}

class TarReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array(0);
  private at = 0;
  private total = 0;
  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }
  async take(
    size: number,
    keep = true,
    eof = false,
  ): Promise<Uint8Array | null> {
    const out = keep ? new Uint8Array(size) : null;
    let written = 0;
    while (written < size) {
      if (this.at === this.chunk.length) {
        const next = await this.reader.read();
        if (next.done) {
          if (eof && written === 0) return null;
          throw new Error(
            "GitHub archive ended before a complete file was received; retry the import",
          );
        }
        this.chunk = next.value;
        this.at = 0;
        this.total += next.value.length;
        if (this.total > MAX_ARCHIVE_BYTES)
          throw new Error(
            "GitHub archive exceeds the 2 GiB streaming import budget",
          );
      }
      const count = Math.min(size - written, this.chunk.length - this.at);
      if (out) out.set(this.chunk.subarray(this.at, this.at + count), written);
      written += count;
      this.at += count;
    }
    return out;
  }
  async close() {
    try {
      await this.reader.cancel();
    } finally {
      this.reader.releaseLock();
    }
  }
}

function paxRecords(bytes: Uint8Array): Record<string, string> {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const records: Record<string, string> = {};
  for (let at = 0; at < bytes.length; ) {
    const space = bytes.indexOf(32, at);
    if (space < 0) throw new Error("Invalid GitHub archive metadata");
    const length = Number(decoder.decode(bytes.subarray(at, space)));
    if (
      !Number.isSafeInteger(length) ||
      length <= space - at + 2 ||
      at + length > bytes.length ||
      bytes[at + length - 1] !== 10
    )
      throw new Error("Invalid GitHub archive metadata");
    const record = decoder.decode(bytes.subarray(space + 1, at + length - 1));
    const equals = record.indexOf("=");
    if (equals > 0) records[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
  return records;
}

export async function readArchive(
  stream: ReadableStream<Uint8Array>,
  maxTextBytes = 32 * 1024 * 1024,
  onFile?: (file: { path: string; text: string }, progress: { count: number; bytes: number; skipped: number }) => Promise<void>,
): Promise<Imported> {
  const reader = new TarReader(stream);
  const decoder = new TextDecoder();
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const files: Imported["files"] = [];
  const paths = new Set<string>();
  let commit: string | null = null;
  let skipped = 0;
  let textBytes = 0;
  let count = 0;
  let extended: Record<string, string> = {};
  try {
    for (;;) {
      const header = await reader.take(512, true, true);
      if (!header || header.every((b) => b === 0)) break;
      const field = (at: number, length: number) =>
        decoder.decode(header.subarray(at, at + length)).replace(/\0.*$/s, "");
      const octal = (value: string) => {
        if (!/^[0-7]+$/.test(value.trim()))
          throw new Error("Invalid GitHub archive header");
        return parseInt(value.trim(), 8);
      };
      const checksum = octal(field(148, 8));
      const actual = header.reduce(
        (sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte),
        0,
      );
      if (checksum !== actual)
        throw new Error("GitHub archive header checksum failed");
      let size = octal(field(124, 12));
      const type = field(156, 1) || "0";
      if (!["g", "x", "L"].includes(type) && extended.size !== undefined)
        size = Number(extended.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES)
        throw new Error(
          "GitHub archive entry exceeds the streaming import budget",
        );
      if (type === "g" || type === "x" || type === "L") {
        if (size > MAX_METADATA_BYTES)
          throw new Error("GitHub archive metadata is too large");
        const body = (await reader.take(size))!;
        await reader.take((512 - (size % 512)) % 512, false);
        if (type === "L")
          extended.path = decoder.decode(body).replace(/\0.*$/s, "");
        else {
          const pax = paxRecords(body);
          if (
            type === "g" &&
            /^[0-9a-f]{40,64}$/.test(pax.comment?.trim() ?? "")
          )
            commit = pax.comment.trim();
          if (type === "x") extended = { ...extended, ...pax };
        }
        continue;
      }
      const prefix = field(345, 155);
      const name =
        extended.path ??
        (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
      extended = {};
      const parts = name.split("/");
      if (
        parts.some((part) => part === ".." || part === ".") ||
        name.startsWith("/") ||
        name.includes("\\") ||
        name.includes("\0")
      )
        throw new Error("GitHub archive contains an unsafe path");
      const path = parts.slice(1).join("/");
      const keep =
        type === "0" &&
        !!path &&
        !SKIP.test(path) &&
        size <= MAX_FILE_BYTES &&
        count < MAX_FILES;
      const body = await reader.take(size, keep);
      await reader.take((512 - (size % 512)) % 512, false);
      if (!keep) {
        if (type === "0") skipped++;
        continue;
      }
      if (body!.subarray(0, 8000).includes(0)) {
        skipped++;
        continue;
      }
      let text: string;
      try {
        text = utf8.decode(body!);
      } catch {
        skipped++;
        continue;
      }
      if (paths.has(path))
        throw new Error("GitHub archive contains duplicate file paths");
      textBytes += size + new TextEncoder().encode(path).length;
      if (textBytes > maxTextBytes)
        throw new Error(
          `Repository text exceeds this workspace's ${Math.floor(maxTextBytes / 1024 / 1024)} MiB source-content budget; the archive was streamed successfully but cannot fit in this workspace`,
        );
      paths.add(path);
      count++;
      if (onFile) await onFile({ path, text }, { count, bytes: textBytes, skipped });
      else files.push({ path, text });
    }
  } finally {
    await reader.close();
  }
  if (!count)
    throw new Error("The repository has no supported text files to import");
  return { files, commit, skipped, count, bytes: textBytes };
}
