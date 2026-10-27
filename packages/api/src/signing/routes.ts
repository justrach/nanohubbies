import {creationBody} from "../abuse";
import type {User} from "../auth";
import {sameOrigin} from "../team/access";
import {signingEmails,currentSigningEmail} from "./identity";
export async function signingRoute(env:Env,request:Request,user:User|null,id?:string) {
  if(!user||request.headers.has("authorization"))return Response.json({error:"Sign in to manage your account's public signing keys"},{status:403});
  const hub=env.HUB.get(env.HUB.idFromName("hub")),emails=signingEmails(user),headers={"Cache-Control":"private, no-store"};
  const current=await Promise.all(emails.emails.map(async email=>await currentSigningEmail(env,user.id,email)?email:null));emails.emails=current.filter((email):email is string=>!!email);
  if(request.method==="GET"&&!id)return Response.json({account:user.id,...emails,keys:await hub.signingKeys(user.id)},{headers});
  if(!sameOrigin(env,request))return Response.json({error:"Same-origin request required"},{status:403});
  try {
    if(request.method==="POST"&&!id) {
      const body=await creationBody<{label:string;publicKey:string}>(request,72*1024);
      if(Object.keys(body).some(key=>!["label","publicKey"].includes(key)))throw Error("Only a key label and public key are accepted");
      return Response.json({account:user.id,...emails,keys:await hub.addSigningKey({id:user.id,name:user.name},body.label,body.publicKey,emails.emails)},{status:201,headers});
    }
    if(request.method==="DELETE"&&id){await hub.revokeSigningKey(user.id,decodeURIComponent(id));return Response.json({account:user.id,...emails,keys:await hub.signingKeys(user.id)},{headers});}
    return Response.json({error:"Method not supported"},{status:405});
  }catch(error){return Response.json({error:(error as Error).message.slice(0,256)},{status:400,headers});}
}
