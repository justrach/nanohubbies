import { creationBody } from "../abuse";
import type { User } from "../auth";
import { changesBetween } from "../browse/history";
import type { TrunkObjects } from "../browse/objects";
import { sameOrigin } from "../team/access";
import { anchorInPatch, type CodeAnchor } from "./comments";
import type { Branch, Pull } from "./types";

export async function pullCommentRoute(env: Env, request: Request, trunk: string, pull: Pull, head: Branch, objects: TrunkObjects, user: User | null, canComment: boolean) {
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const list = () => seq.pullComments({ op: "list", number: pull.number });
  if (request.method === "GET") return Response.json({ ...await list(), canComment:canComment&&pull.state==="open" });
  if (!["POST", "PATCH"].includes(request.method)) return Response.json({error:"Use GET, POST or PATCH for review conversations"}, {status:405});
  if (!canComment || !user) return Response.json({error:"Inline review requires a signed-in repository writer"}, {status:403});
  if (!sameOrigin(env, request)) return Response.json({error:"Same-origin request required"}, {status:403});
  try {
    const body = await creationBody<Record<string,unknown>>(request, 32 * 1024);
    const fields = request.method === "PATCH" ? ["commit","anchor","id","resolved"] : ["commit","anchor","id","body","path","side","startLine","line","replyTo"];
    if (Object.keys(body).some(key => !fields.includes(key))) return Response.json({error:"Unknown review comment field"},{status:400});
    if (body.commit !== head.commit || body.anchor !== pull.anchor) return Response.json({error:"PR changed; refresh and review its latest diff"},{status:409});
    if (typeof body.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(body.id)) return Response.json({error:"Provide a valid comment ID"},{status:400});
    const observed = { number:pull.number, commit:head.commit, anchor:pull.anchor, actor:{id:user.id,origin:new URL(request.url).origin} };
    if (request.method === "PATCH") {
      if (typeof body.resolved !== "boolean") return Response.json({error:"Choose a thread resolution"},{status:400});
      return Response.json({ ...await seq.pullComments({...observed,op:"resolve",id:body.id,resolved:body.resolved}), canComment });
    }
    if (typeof body.body !== "string" || !body.body.trim() || body.body.length > 16000 || body.replyTo !== undefined && body.replyTo !== null && typeof body.replyTo !== "string")
      return Response.json({error:"Provide a comment of 1–16000 characters"},{status:400});
    let anchor: CodeAnchor, commit = head.commit, comparison = pull.anchor, excerpt = "";
    if (body.replyTo) {
      const root = (await list()).comments.find(c => c.id === body.replyTo && !c.replyTo);
      if (!root) return Response.json({error:"No such review thread"},{status:404});
      anchor = {path:root.path,side:root.side,startLine:root.startLine,line:root.line};
      commit = root.commit; comparison = root.anchor;
    } else {
      if (typeof body.path !== "string" || body.path.length > 2048) return Response.json({error:"Select a changed file"},{status:400});
      anchor = {path:body.path,side:body.side,startLine:body.startLine,line:body.line} as CodeAnchor;
      const diff = await changesBetween(objects, pull.anchorTree, head.tree);
      const patch = diff.files.find(file => file.path === anchor.path)?.patch ?? null;
      if (!anchorInPatch(patch, anchor)) return Response.json({error:"Select up to 201 visible lines within one diff hunk"},{status:400});
      const chunk = patch!.split(/(?=^@@ )/m).find(part => anchorInPatch(part, anchor)) ?? "";
      excerpt = chunk.length > 24000 ? chunk.slice(0,24000) + "\n[Original hunk excerpt truncated]" : chunk;
    }
    const result = await seq.pullComments({...observed,op:"add",comment:{...anchor,id:body.id,pull:pull.number,commit,anchor:comparison,excerpt,author:{id:user.id,name:user.name},body:body.body.trim(),at:Date.now(),replyTo:(body.replyTo as string|null)??null,resolved:false,...(user.cli?{via:{kind:"cli" as const,credentialId:user.cli.credentialId}}:{})}});
    return Response.json({...result,canComment});
  } catch(error) {
    const message = (error as Error).message;
    return Response.json({error:message},{status:/No such/.test(message)?404:/changed|no longer open|already used/.test(message)?409:/signed-in repository writer/.test(message)?403:400});
  }
}
