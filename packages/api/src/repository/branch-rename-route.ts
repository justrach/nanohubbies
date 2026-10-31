import {creationBody} from '../abuse';
import type {User} from '../auth';
import {canAdmin,canWrite,sameOrigin,type TeamAccess} from '../team/access';
import {TeamError} from '../team/provider';
import {archiveLocked} from './archive';
import {repositoryProof} from './rule-proof';
import {ObjectReader} from '../objects';
import type {BranchRenameInput} from './branch-rename-types';
const headers={'Cache-Control':'private, no-store'},json=(value:unknown,status=200)=>Response.json(value,{status,headers});
const methods=['branchRenameConfiguration','branchRenamePreview','renameRepositoryBranch'];
const missing=(error:unknown)=>error instanceof Error&&methods.some(method=>error.message.includes(`does not implement the method "${method}"`));
const updating=()=>Response.json({error:'Branch rename administration is updating; inspect branch list again shortly'},{status:503,headers:{...headers,'Retry-After':'5'}});
export async function branchRenameRoute(env:Env,request:Request,trunk:string,user:User|null,access:TeamAccess|null,id?:string,operation?:string){
 if(id||operation)return json({error:'Unknown branch rename operation'},404);
 if(!['GET','POST'].includes(request.method))return json({error:'Use GET or POST'},405);
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk)),hub=env.HUB.get(env.HUB.idFromName('hub')),url=new URL(request.url),delegated=!!user?.cli;
 const entry=await hub.find(trunk),account=!!user&&!request.headers.has('authorization'),writer=account&&(access?canWrite(access):entry?.owner===user!.id),admin=account&&(access?canAdmin(access):entry?.owner===user!.id),editor=writer&&(!delegated||user!.cli!.scopes.includes('branches:write'));
 if(request.method==='POST'&&(!editor||!sameOrigin(env,request)))return json({error:'Current repository write access and branches:write permission are required'},403);
 try{
  const configuration=await seq.branchRenameConfiguration();
  if(configuration.protocol!==1||configuration.conditionalWrites!==true||configuration.revisionTracking!=='storage'||configuration.cliAudit!==true)return updating();
  if(request.method==='GET'){
   const params=url.searchParams;
   if([...params.keys()].some(key=>!['from','to'].includes(key)||params.getAll(key).length!==1)||params.has('from')!==params.has('to'))return json({error:'Use one from and to branch for a rename preview'},400);
   const readOnly=archiveLocked(await hub.repositoryArchive(trunk));
   const preview=params.has('from')?await seq.branchRenamePreview(params.get('from')!,params.get('to')!):undefined;
   return Response.json({...configuration,readOnly,canRename:editor&&!readOnly&&configuration.mode==='git',canRenameProtected:admin,...(preview?{preview}: {})},{headers:{...headers,ETag:`"branch-rename-${configuration.revision}"`}});
  }
  if(url.search)return json({error:'Use the request body for branch rename edits'},400);
  const body=await creationBody<BranchRenameInput>(request,2048);
  if(!body||Array.isArray(body)||Object.keys(body).some(key=>!['from','to','commit','revision'].includes(key))||typeof body.from!=='string'||typeof body.to!=='string'||typeof body.commit!=='string'||!/^[a-f0-9]{40}$/.test(body.commit)||typeof body.revision!=='string'||!/^[a-f0-9]{64}$/.test(body.revision))return json({error:'Use source and destination branch names, the observed commit and rename revision'},400);
  if(delegated){const condition=request.headers.get('If-Match');if(condition===null)return json({error:'Use If-Match with the revision from branch list'},428);if(condition!==`"branch-rename-${body.revision}"`)return json({error:'If-Match must match the rename revision in the body'},400);}
  if(configuration.revision!==body.revision)return json({error:'Branches or repository settings changed; inspect branch list before renaming',conflict:true,revision:configuration.revision},delegated?412:409);
  const preview=await seq.branchRenamePreview(body.from,body.to);
  if(preview.requiresAdmin&&!admin)return json({error:'Current repository admin access is required to rename default or protected branches'},403);
  await hub.assertRepositoryWritable(trunk);
  const reader=new ObjectReader(env.OBJECTS,trunk,async()=>(await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs),plan=await seq.graphPlan();
  const verify=(sha:string,raw:Uint8Array)=>hub.verifyCommitSignature(trunk,sha,raw);
  const proof=await repositoryProof(sha=>reader.get(sha),null,body.commit,plan,'refs/heads/'+body.to,verify);
  const sourceProof=await repositoryProof(sha=>reader.get(sha),body.commit,body.commit,plan,'refs/heads/'+body.from,verify);
  const result=await seq.renameRepositoryBranch(body,user!.id,url.origin,proof,sourceProof,user?.cli?.credentialId);
  return 'conflict' in result?json({error:'Branches or repository settings changed; inspect branch list before renaming',...result},delegated?412:409):json(result);
 }catch(error){
  if(error instanceof Response)return error;if(error instanceof TeamError)throw error;if(missing(error))return updating();
  const message=(error as Error).message;return json({error:message},/Current .* (membership|access|credential)/.test(message)?403:400);
 }
}
