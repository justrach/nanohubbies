import type { User } from "../auth";
import { listTokens } from "../tokens";

/** Authorized, request-local startup data. Never cache this response across
 * people: token metadata and private repository details belong to this caller. */
export async function workspaceBootstrap(env: Env, trunk: string, user: User | null, providers: { codegraff: boolean; dev: boolean }) {
  const hub = env.HUB.get(env.HUB.idFromName("hub"));
  const entry = await hub.find(trunk);
  if (!entry) return Response.json({ error: "no such workspace" }, { status: 404 });
  const [headResult, job, repo, tokens] = await Promise.all([
    env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)).info().then(info => ({info, error:null}), error => ({info:null, error})),
    env.IMPORT_JOB ? env.IMPORT_JOB.get(env.IMPORT_JOB.idFromName(trunk)).status() : null,
    env.ROOM.get(env.ROOM.idFromName(trunk)).repo(),
    user ? listTokens(env, {id:user.id, name:user.name}) : [],
  ]);
  if (headResult.error && !(job && !job.ready)) throw headResult.error;
  return Response.json({
    workspace: entry, info: headResult.info, job, repo,
    session: {user, providers},
    tokens: tokens.filter(token => token.trunk === trunk && token.expiresAt > Date.now()),
  }, {headers:{"Cache-Control":"private, no-store"}});
}
