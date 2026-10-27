/** A partial account inventory cannot prove absence of an individual bucket. */
export function bucketExists(result, name) {
  const text = result.stdout + "\n" + result.stderr;
  if (result.code === 0) {
    if (
      !text
        .split("\n")
        .some(
          (line) =>
            line.trim() === `name:                   ${name}` ||
            (/^name:\s+/.test(line) &&
              line.replace(/^name:\s+/, "").trim() === name),
        )
    )
      throw Error("Exact bucket identity not confirmed");
    return true;
  }
  if (
    /\[code: 10006\]/.test(text) &&
    /specified bucket does not exist/i.test(text)
  )
    return false;
  throw Error("Exact bucket existence could not be confirmed");
}
