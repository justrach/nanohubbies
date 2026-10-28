import {rulesetBypass,type RulesetActor} from '../repository/bypass';
import {archiveLocked} from "../repository/archive";
import { canAdmin, canWrite, sameOrigin, type TeamAccess } from "../team/access";
import { creationBody } from "../abuse";
import { isAncestor } from "../repository/validate";
import { repositoryProof } from "../repository/rule-proof";
import { codeOwnerEvidence } from "../repository/codeowners";
import { visibleRuleset } from "../repository/ruleset-view";
import { ObjectReader } from "../objects";
import { settings, type User } from "../auth";
import { changesBetween } from "../browse/history";
import { blobText, TrunkObjects } from "../browse/objects";
import { entryAt } from "../trees";
import { isDir, readTree } from "../git";
import { pusher } from "../tokens";
import type { Owner } from "../types";
import { mergeBase, mergeEdits, publishObjects, replay, restackCommit } from "./graph";
import { branchName, type Branch, type Review } from "./types";
import { pullCommentRoute } from "./pull-comment-route";
import { pendingReviewRoute } from "./pending-route";
import { suggestionRoute } from "./suggestion-route";
import {applies} from "../repository/rulesets";
import {signatureGate} from "../signing/gate";

/** Called only after the workspace's ordinary authorization boundary. */
export async function reviewRoute(env: Env, request: Request, trunk: string, action: string, id: string | undefined, operation: string | undefined, user: User | null, access:TeamAccess|null = null, tail: string[] = []) {
  const url = new URL(request.url), method = request.method;
  const seq = env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  const verifySignature=(sha:string,raw:Uint8Array)=>env.HUB.get(env.HUB.idFromName("hub")).verifyCommitSignature(trunk,sha,raw);
  let s = await seq.review({ op: "snapshot" });
  s.archive=await env.HUB.get(env.HUB.idFromName("hub")).repositoryArchive(trunk);
  const writable=!archiveLocked(s.archive);
  s.canProtect = !!user && !user.cli && !request.headers.has("authorization") && (access?canAdmin(access):(await env.HUB.get(env.HUB.idFromName("hub")).find(trunk))?.owner === user.id);
  s.canConfigure = !!user && !user.cli && (await env.HUB.get(env.HUB.idFromName("hub")).find(trunk))?.owner === user.id;
  const accountWriter=!!user&&!request.headers.has("authorization")&&(access?canWrite(access):s.canConfigure===true);
  const humanWriter=accountWriter&&!user?.cli;
  const json = (value: unknown, init?: ResponseInit) => {
    // Apply the same view to GET snapshots and mutation responses. A writer
    // must not learn bypass identities by creating a branch or review.
    if(value && typeof value === "object" && "rulesets" in value && Array.isArray(value.rulesets))
      return Response.json({...value,archive:s.archive,canProtect:s.canProtect,canConfigure:s.canConfigure,rulesets:value.rulesets.map(r=>visibleRuleset(r,s.canProtect===true))},init);
    return Response.json(value,init);
  };
  const objects = new TrunkObjects(env, trunk, 16000);
  const branch = (name: string): Branch => {
    const b = s.branches.find((b) => b.name === name);
    if (!b) throw new Error(`No branch ${name}`);
    return b;
  };
  let independent = !!user && !user.cli && !request.headers.has("authorization");
  let owner: Owner | null = user ? { id: user.id, name: user.name } : null;
  let actor: Owner | null = owner;
  if (method !== "GET") {
    const credential = request.headers.has("authorization") ? await pusher(env, request, trunk) : null;
    if (request.headers.has("authorization") && !credential) return json({ error: "Invalid agent credential" }, { status: 401 });
    owner = credential?.owner ?? owner;
    independent = !!user && !user.cli && !credential;
    actor = credential ? { id: credential.agentId ?? credential.owner.id, name: credential.agent ?? credential.owner.name } : owner;
    if (!owner) return json({ error: "Sign in or use a workspace agent credential" }, { status: 401 });
    const origin = request.headers.get("origin");
    const localPreview = origin && settings(env, url).dev && ["localhost", "127.0.0.1"].includes(url.hostname)
      && new URL(origin).hostname === url.hostname;
    if (origin && origin !== url.origin && !localPreview) return json({ error: "Same-origin request required" }, { status: 403 });
  }
  if (action === "branches") {
    if (method === "GET" && !id) return json(s);
    if (method === "GET" && id === "tree") {
      const b = branch(url.searchParams.get("name") ?? s.defaultBranch??"main");
      const path = url.searchParams.get("path") ?? "";
      if (path.split("/").some((p) => p === ".." || p === ".") || path.includes("\\")) throw new Error("Invalid path");
      const e = await entryAt(objects, b.tree, path);
      if (!e) return json({ error: "No such path" }, { status: 404 });
      return json(isDir(e)
        ? { branch: b, path, entries: readTree(await objects.body(e.sha, "tree")).map((e) => ({ name: e.name, directory: isDir(e) })).sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name)) }
        : { branch: b, path, text: blobText(await objects.body(e.sha, "blob")), mode: e.mode });
    }
    if (method === "POST" && !id) {
      const body = await request.json<{ name: string; from?: string }>();
      const name = branchName(body.name), source = branch(body.from ?? s.defaultBranch??"main");
      const reader=new ObjectReader(env.OBJECTS,trunk,async()=>(await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
      const proof=await seq.repositoryMode()?await repositoryProof(sha=>reader.get(sha),null,source.commit,await seq.graphPlan(),`refs/heads/${name}`,verifySignature):undefined;
      return json(await seq.review({ op: "branch", name, old: null, source, next: source, actor: owner!.id, human:independent, origin:url.origin, proof }));
    }
    if (method === "DELETE" && !id) {
      const body = await request.json<{ name: string; commit: string }>();
      return json(await seq.review({ op: "branch", name: branchName(body.name), old: body.commit, next: null, actor:owner!.id, human:independent, origin:url.origin }));
    }
  }
  if (action === "pulls") {
    // Nested dismissal routes must never fall through to review creation.
    const dismissal=operation === "reviews" && tail.length===2 && /^[1-9]\d*$/.test(tail[0]) && Number.isSafeInteger(Number(tail[0])) && tail[1]==="dismissals";
    const pendingOperation=operation==="pending-review"&&(tail.length===0||tail.length===1&&tail[0]==="submit");
    const suggestionOperation=operation==="suggestions"&&tail.length===1&&tail[0]==="apply";
    if (tail.length && !dismissal && !pendingOperation && !suggestionOperation) return json({error:"Review operation not found"},{status:404});
    if (!id) {
      if (method === "GET") return json(s);
      if (method === "POST") {
        const body = await request.json<{ title: string; body?: string; head: string; base?: string }>();
        const head = branch(body.head), base = branch(body.base ?? s.defaultBranch??"main");
        const anchor = await mergeBase(objects, head.commit, base.commit);
        if (head.tree === anchor.tree) throw new Error("This branch has no changes to review");
        return json(await seq.review({ op: "open", title: body.title, body: body.body ?? "", head, base, anchor: anchor.commit, anchorTree: anchor.tree, author: owner! }));
      }
    } else {
      let p = s.pulls.find((p) => p.number === Number(id));
      if (!p) return json({ error: "No such pull request" }, { status: 404 });
      if (dismissal) {
        if (method !== "PUT") return json({error:"Use PUT to dismiss a review"},{status:405});
        if (!humanWriter) return json({error:"Review dismissal requires a signed-in repository writer"},{status:403});
        if (!sameOrigin(env,request)) return json({error:"Same-origin request required"},{status:403});
        const allowed=s.effectivePolicies?.[p.base]?.allowDismiss;
        if (allowed!==undefined&&!allowed.includes(user!.id)) return json({error:"Account is not allowed to dismiss reviews for this branch"},{status:403});
        try {
          const body=await creationBody<{message:string;event?:string}>(request,64*1024);
          if (Object.keys(body).some(key=>!["message","event"].includes(key)) || body.event!==undefined&&body.event!=="DISMISS" || typeof body.message!=="string" || !body.message.trim() || body.message.length>16000)
            return json({error:"Provide a dismissal message of up to 16000 characters"},{status:400});
          return json(await seq.review({op:"dismiss",number:p.number,reviewId:Number(tail[0]),actor:{id:user!.id,name:user!.name},reason:body.message,human:true,origin:url.origin}));
        } catch(error) {
          const message=(error as Error).message;
          return json({error:message},{status:message.includes("No such review")?404:message.includes("already been dismissed")||message.includes("no longer open")?409:message.includes("not allowed to dismiss")||message.includes("requires a signed-in repository writer")?403:400});
        }
      }
      const head = p.state === "open" ? branch(p.head) : { name: p.head, commit: p.headCommit, tree: p.headTree, updatedAt: p.updatedAt };
      if(s.repositoryMode&&p.state==="open"&&(method==="GET"||["POST","PATCH"].includes(method)&&["reviews","restack","merge","comments","pending-review","suggestions"].includes(operation??""))) {
        const base=branch(p.base),anchor=await mergeBase(objects,head.commit,base.commit);
        if(anchor.commit!==p.anchor||anchor.tree!==p.anchorTree) {
          const next=await seq.review({op:"compare",number:p.number,head,base,previousAnchor:p.anchor,anchor:anchor.commit,anchorTree:anchor.tree});
          s={...next,canProtect:s.canProtect,canConfigure:s.canConfigure};p=s.pulls.find(row=>row.number===Number(id))!;
        }
      }
      if (operation === "comments") return pullCommentRoute(env, request, trunk, p, head, objects, user, accountWriter);
      if (pendingOperation) return pendingReviewRoute(env,request,trunk,p,head,objects,user,accountWriter,tail[0]==="submit");
      if (suggestionOperation) return suggestionRoute(env,request,trunk,p,head,objects,user,humanWriter);
      if (method === "GET" && operation === "file") {
        const before = url.searchParams.get("side") === "base", path = url.searchParams.get("path") ?? "";
        const file = await entryAt(objects, before ? p.anchorTree : head.tree, path);
        if (!file || isDir(file)) return json({ error: "No file at this PR revision" }, { status: 404 });
        return json({ path, commit: before ? p.anchor : head.commit, text: blobText(await objects.body(file.sha, "blob")), mode: file.mode });
      }
      if (method === "GET" && !operation) {
        const authority:RulesetActor|undefined=humanWriter&&access?{actor:user!.id,role:access.proof.role==='member'?'writer':access.proof.role,checkedAt:access.proof.verifiedAt,expiresAt:access.proof.verifiedAt+30000}:undefined;
        const signatureRequired=!!s.effectivePolicies?.[p.base]?.requireSignedCommits||!!s.rulesets?.some(rule=>applies(rule,`refs/heads/${p.base}`,s.defaultBranch)&&rule.rules.some(r=>r.type==="required_signatures")&&!rulesetBypass(rule,user?.id??"",humanWriter,true,authority));
        const signatures=s.repositoryMode&&p.state==="open"?await signatureGate(env,trunk,head,branch(p.base),signatureRequired):undefined;
        const codeOwners=s.repositoryMode?(p.state==="open"?await seq.codeOwnersStatus(p.number,await codeOwnerEvidence(objects,branch(p.base),head),url.origin):p.codeOwners):undefined;
        const deployments=s.repositoryMode?(p.state==="open"?await seq.deploymentGate(p.base,head.commit,branch(p.base).commit,user?.id??"",humanWriter,p.head,url.origin):p.deployments):undefined;
        const allowed=s.effectivePolicies?.[p.base]?.allowDismiss;
        return json({ ...s, pull: p, head, codeOwners,signatures,deployments,canDismissReviews:writable&&humanWriter&&(allowed===undefined||allowed.includes(user!.id)),pendingReview:humanWriter?(await seq.pendingReview({op:"get",number:p.number,actor:{id:user!.id,origin:url.origin}})).pending:null,discussion:{...await seq.pullComments({op:"list",number:p.number}),canComment:writable&&accountWriter&&(!user?.cli||user.cli.scopes.includes("reviews:write"))&&p.state==="open"},reviewGate:await seq.reviewGate(p.number,head.commit,p.anchor,url.origin), ...(await changesBetween(objects, p.anchorTree, head.tree)) });
      }
      if (method === "POST" && operation === "close") return json(await seq.review({ op: "close", number: p.number }));
      if (method === "POST" && ["reviews", "restack", "merge"].includes(operation ?? "")) {
        const body = await request.json<{ commit: string; anchor: string; body?: string; verdict?: Review["verdict"] }>();
        if (operation === "merge" && p.state === "merged") return json(s);
        if (body.commit !== head.commit || body.anchor !== p.anchor) return json({ error: "PR changed; refresh and review its latest diff" }, { status: 409 });
        if (operation === "reviews") return json(await seq.review({ op: "review", number: p.number, author: actor!, body: body.body ?? "", verdict: body.verdict ?? "COMMENT", commit: head.commit, anchor: p.anchor, independent:independent||!!user?.cli,origin:url.origin,...(user?.cli?{via:{kind:"cli" as const,credentialId:user.cli.credentialId}}:{}) }));
        if (operation === "merge" && !s.repositoryMode&&p.base !== "main") return json({ error: "Merge the parent PR first" }, { status: 409 });
        const base = branch(p.base);
        if (operation === "merge" && await seq.repositoryMode()) {
          const reader = new ObjectReader(env.OBJECTS, trunk, async () => (await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
          if (!await isAncestor(sha => reader.get(sha), base.commit, head.commit)) throw new Error("Target branch moved: merge its current head into the feature branch, push and rerun CI before merging");
          const main = await seq.head();
          const ownership=s.effectivePolicies?.[p.base]?.requireCodeOwnerReview?await codeOwnerEvidence(objects,base,head):undefined;
          return json(await seq.review({ op: "merge", number: p.number, head, base:{...base,version:main.version}, anchor: p.anchor,
            codeOwners:ownership,origin:url.origin,
            candidate: { commit: head.commit, tree: head.tree, base: base.commit }, human:independent, proof:await repositoryProof(sha=>reader.get(sha),base.commit,head.commit,await seq.graphPlan(),`refs/heads/${p.base}`,verifySignature),
            request: { id: `pr-${p.number}-${head.commit}-${base.commit}`, agent: "review", owner, kind: "agent", life: 0, intent: p.title, base: main.version, reads: { strong: [], weak: [] }, edits: [], issue: null, closes: false } }));
        }
        const result = await replay(objects, p.anchorTree, head.tree, base.tree);
        if (operation === "restack") {
          const made = restackCommit(result.root, base.commit, actor!, p.title);
          await publishObjects(env, trunk, [...result.objects, made]);
          const reader=new ObjectReader(env.OBJECTS,trunk,async()=>(await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
          const proof=await seq.repositoryMode()?await repositoryProof(sha=>reader.get(sha),head.commit,made.sha,await seq.graphPlan(),`refs/heads/${p.head}`,verifySignature):undefined;
          return json(await seq.review({ op: "restack", number: p.number, head, base, anchor: p.anchor, next: { commit: made.sha, tree: result.root }, actor:owner!.id,human:independent,origin:url.origin,proof }));
        }
        const main = await seq.head();
        if (main.commit !== base.commit) return json({ error: "Main changed; refresh and try again" }, { status: 409 });
        const edits = await mergeEdits(objects, result.patches, main.tree);
        if (!edits.length) throw new Error("These changes are already on main; close this PR");
        const merged = await seq.review({ op: "merge", number: p.number, head, base: main, anchor: p.anchor,origin:url.origin,
          request: { id: `pr-${p.number}-${head.commit}-${main.commit}`, agent: "review", owner, kind: "agent", life: 0, intent: `Merge #${p.number}: ${p.title}`, base: main.version,
            reads: { strong: [], weak: [] }, edits, issue: null, closes: false } });
        const landed = merged.pulls.find((q) => q.number === p.number)!;
        if (landed.mergedVersion) await seq.whenPublished(landed.mergedVersion);
        return json(merged);
      }
    }
  }
  return json({ error: "Method or route not supported" }, { status: 405 });
}
