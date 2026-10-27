import { creationBody } from "../abuse";
import type { User } from "../auth";
import type { TrunkObjects } from "../browse/objects";
import { ObjectReader } from "../objects";
import { repositoryProof } from "../repository/rule-proof";
import { sameOrigin } from "../team/access";
import { publishObjects } from "./graph";
import { suggestionCommit } from "./suggestion-graph";
import type { Branch,Pull } from "./types";

export async function suggestionRoute(env:Env,request:Request,trunk:string,pull:Pull,head:Branch,objects:TrunkObjects,user:User|null,humanWriter:boolean) {
  if(request.method!=="POST")return Response.json({error:"Use POST to apply suggestions"},{status:405});
  if(!humanWriter||!user)return Response.json({error:"Applying suggestions requires a signed-in repository writer"},{status:403});
  if(!sameOrigin(env,request))return Response.json({error:"Same-origin request required"},{status:403});
  const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
  try {
    const body=await creationBody<Record<string,unknown>>(request,8192);
    if(Object.keys(body).some(key=>!["id","commit","anchor","commentIds","message"].includes(key)))throw Error("Unknown suggestion application field");
    if(typeof body.id!=="string"||!/^[a-zA-Z0-9-]{8,80}$/.test(body.id)||typeof body.commit!=="string"||typeof body.anchor!=="string"||typeof body.message!=="string"||!body.message.trim()||body.message.trim().length>200||/[\r\n\0]/.test(body.message))throw Error("Provide a request ID, observed diff and one-line commit message of up to 200 characters");
    if(!Array.isArray(body.commentIds)||body.commentIds.length<1||body.commentIds.length>50||new Set(body.commentIds).size!==body.commentIds.length||body.commentIds.some(id=>typeof id!=="string"||!/^[a-zA-Z0-9-]{8,80}$/.test(id)))throw Error("Select 1–50 different suggestions");
    const observed={id:body.id,number:pull.number,commit:body.commit,anchor:body.anchor,commentIds:(body.commentIds as string[]).sort(),message:body.message.trim(),actor:{id:user.id,name:user.name},origin:new URL(request.url).origin};
    const prior=await seq.suggestionApplication(observed);if(prior)return Response.json({application:prior});
    if(!await seq.repositoryMode())throw Error("Applying suggestions requires a Git repository");
    if(pull.state!=="open")throw Error("This pull request is no longer open");
    if(head.commit!==body.commit||pull.anchor!==body.anchor)return Response.json({error:"PR changed; refresh and review its latest diff"},{status:409});
    const discussion=await seq.pullComments({op:"list",number:pull.number});
    const comments=observed.commentIds.map(id=>{const comment=discussion.comments.find(c=>c.id===id);if(!comment)throw Error("No such suggestion on this pull request");return comment;});
    const next=await suggestionCommit(objects,pull,head,comments,observed.actor,observed.message);
    await publishObjects(env,trunk,next.objects);
    const reader=new ObjectReader(env.OBJECTS,trunk,async()=>(await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
    const proof=await repositoryProof(sha=>reader.get(sha),head.commit,next.commit,await seq.graphPlan(),`refs/heads/${pull.head}`,(sha,raw)=>env.HUB.get(env.HUB.idFromName("hub")).verifyCommitSignature(trunk,sha,raw));
    return Response.json({application:await seq.applySuggestions({...observed,comments,next:{commit:next.commit,tree:next.tree},proof})});
  }catch(error) {
    const message=(error as Error).message;
    return Response.json({error:message},{status:/No such/.test(message)?404:/changed|earlier|was applied|after-side|already used|no longer open/.test(message)?409:/signed-in repository writer/.test(message)?403:400});
  }
}
