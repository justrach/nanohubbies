/** Bound streaming input before allocating or decompressing untrusted bytes. */
export async function readGitBody(request: Request, max = 32 << 20) {
  if (Number(request.headers.get("content-length")) > max) throw new Error("Git request exceeds 32 MiB");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw new Error("Git request exceeds 32 MiB"); }
    chunks.push(value);
  }
  const body = new Uint8Array(length); let at = 0;
  for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
  return body;
}
