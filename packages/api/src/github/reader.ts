import type { User } from "../auth";
import { githubToken, type Reader } from "./api";

/** How a page was read from GitHub, so the page can say so: with the
 *  signed-in person's own connection, the deployment's token, or nothing.
 *  `connect` says where the person can connect GitHub to read with theirs. */
export type Access = { as: "you"; login: string } | { as: "server" | "anonymous"; connect?: string };

/** The ways this request can read GitHub, best first. Signed in with
 *  Codegraff, with GitHub connected there: that connection, so the rate limit
 *  is the person's own. Then the deployment's token if it has one, else none.
 *  A connection may not reach a public repository it was never given, which
 *  anyone can read, so the shared way stays as the fallback. */
export async function readersFor(env: Env, user: User | null, origin: string, repository?: string): Promise<{ reader: Reader; access: Access }[]> {
  const token = githubToken(env);
  const as = token ? "server" : "anonymous";
  const shared = { reader: { token, cache: "public" }, access: { as } as Access };
  if (user?.provider !== "codegraff") return [shared];
  if (repository) {
    try {
      const token = await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).githubToken(origin, [repository], true);
      return [{ reader: { token, cache: user.id }, access: { as: "you", login: user.name } }, shared];
    } catch { return [shared]; }
  }
  const got = await env.ACCOUNT.get(env.ACCOUNT.idFromName(user.id)).githubReader(origin);
  if ("token" in got) return [{ reader: { token: got.token, cache: user.id }, access: { as: "you", login: got.login } }, shared];
  return [{ ...shared, access: { as, connect: "connect" in got ? got.connect : undefined } }];
}
