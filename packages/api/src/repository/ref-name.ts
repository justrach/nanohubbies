/** Bound the complete ref, including refs/heads/ or refs/tags/, in UTF-8 bytes.
 * Never trim, case-fold or normalize names: canonically equivalent spellings
 * are distinct Git refs. */
export const MAX_REF_BYTES = 255;
/** Form line separators/ASCII padding are not part of a valid literal ref.
 * Unicode whitespace can be, so String.trim() would change the target. */
export const patternLines = (value: unknown) => String(value ?? "").split(/\r?\n/).map(line => line.replace(/^[ \t\r]+|[ \t\r]+$/g, "")).filter(Boolean);
const utf8 = new TextEncoder();
export function wellFormedName(value: string) {
  for (const char of value) { const code = char.codePointAt(0)!; if (code >= 0xd800 && code <= 0xdfff) return false; }
  return true;
}
/** Shared syntax also validates projected glob literals, with their own bound. */
export function refSuffix(name: unknown, prefix = "refs/heads/", maxBytes = MAX_REF_BYTES): string {
  if (typeof name !== "string" || !name.length || name.length > maxBytes || !wellFormedName(name) || utf8.encode(prefix + name).length > maxBytes
    || /[\x00-\x20\x7f~^:?*\[\\]/u.test(name) || name.includes("..") || name.includes("@{")
    || name.startsWith("/") || name.endsWith("/") || name.includes("//") || name.endsWith(".")
    || name.split("/").some(part => part.startsWith(".") || part.endsWith(".lock")))
    throw Error(`Invalid Git ref name: use a well-formed UTF-8 name with Git ref syntax, at most ${maxBytes} bytes including ${prefix || "the prefix"}`);
  return name;
}
export const branchName = (name: unknown) => refSuffix(name);
export const tagName = (name: unknown) => refSuffix(name, "refs/tags/");
export function refName(name: string) {
  const match = typeof name === "string" && /^refs\/(heads|tags)\/([\s\S]+)$/.exec(name);
  if (!match) throw Error("Only branch and tag refs are supported");
  refSuffix(match[2], `refs/${match[1]}/`); return name;
}
/** GitHub's additional ambiguity restrictions apply when creating refs.
 * Existing names accepted by older versions remain addressable/deletable. */
export function newRefName(name: string) {
  refName(name); const suffix = name.replace(/^refs\/(heads|tags)\//, "");
  if (suffix.startsWith("refs/") || /^[a-f0-9]{40}$/i.test(suffix)) throw Error("New branch/tag names cannot begin with refs/ or look like a 40-character Git object ID");
  return name;
}
