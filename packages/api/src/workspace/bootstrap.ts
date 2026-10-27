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
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const mode = await seq.repositoryMode() ? "git" : "snapshot";
  let defaultBranch="main";
  if(mode==="git")try{defaultBranch=(await seq.repositoryConfiguration()).defaultBranch;}catch(error){if(!(error instanceof Error)||!error.message.includes('does not implement the method "repositoryConfiguration"'))throw error;}
  const empty = mode === "git" && !(await seq.repositoryRefs()).some(r => r.name === `refs/heads/${defaultBranch}`);
  if (headResult.error && !empty && !(job && !job.ready)) throw headResult.error;
  return Response.json({
    archive:await hub.repositoryArchive(trunk),
    address: await hub.repositoryAddress(trunk), access: {private:!!await hub.team(trunk)},
    workspace: entry, repository: { mode, empty,defaultBranch }, info: headResult.info, job, repo,
    session: {user, providers},
    tokens: tokens.filter(token => token.trunk === trunk && token.expiresAt > Date.now()),
  }, {headers:{"Cache-Control":"private, no-store"}});
}
