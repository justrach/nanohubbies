import type { Sequencer } from "../sequencer";
import type { SubmitResult } from "../types";

/** Waiting never changes the landing decision. A timeout or publication error
 *  returns the durable receipt as pending, not a failed change to resubmit. */
export async function acknowledge(seq: Pick<Sequencer, "whenPublished">, result: SubmitResult, timeout = 10_000): Promise<Response> {
  if (result.status !== "landed") return Response.json(result);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const published = await Promise.race([
      seq.whenPublished(result.version).then(() => true, () => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeout); }),
    ]);
    return Response.json({ ...result, publication: published ? "published" : "pending" }, { status: published ? 200 : 202 });
  } finally {
    clearTimeout(timer);
  }
}
