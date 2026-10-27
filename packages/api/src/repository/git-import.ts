import {pusher} from '../tokens';
import {canWrite,type TeamAccess} from '../team/access';
import {archiveLocked} from './archive';
import {readGitBody} from './bytes';
import {repositoryLimits} from './validate';
import {unpack} from '../unpack';
import {encode} from '../git';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});

/** A Git transport extension. Git credentials gain no application API access. */
export async function gitImport(request:Request,env:Env,trunk:string,path:string,access:TeamAccess|null,ciRead:boolean){
 if(ciRead)return json({error:'CI clone credentials cannot administer imports'},403);
 const who=await pusher(env,request,trunk);
 if(!who)return new Response('Repository Git authentication required',{status:401,headers:{'WWW-Authenticate':'Basic realm="nanohub"','Cache-Control':'private, no-store'}});
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
 if(!(await seq.repositoryMode()))return json({error:'Batch import requires Git repository mode'},400);
 if(path==='nanohub-import'){
  if(request.method!=='GET')return json({error:'Use GET for import discovery'},405);
  let initialImportMaxRefs=100;
  try{initialImportMaxRefs=await seq.repositoryImportLimit();}
  catch(error){if(!(error instanceof Error)||!error.message.includes('does not implement the method "repositoryImportLimit"'))throw error;}
  const archive=await env.HUB.get(env.HUB.idFromName('hub')).repositoryArchive(trunk);
  return json({protocol:'nanohub-git-import-v1',...(await seq.repositoryConfiguration()),refs:await seq.repositoryRefs(),initialImportMaxRefs,writable:canWrite(access)&&!who.readOnly&&!archiveLocked(archive)});
 }
 if(path!=='nanohub-import/objects')return json({error:'Unknown import operation'},404);
 if(request.method!=='POST')return json({error:'Use POST for an object batch'},405);
 if(!canWrite(access)||who.readOnly)return json({error:'Current repository write access and Git push permission required'},403);
 await env.HUB.get(env.HUB.idFromName('hub')).assertRepositoryWritable(trunk);
 if((await seq.repositoryRefs()).length)return json({error:'Batch import requires an empty Git repository; inspect its refs'},409);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/x-git-packed-objects')return json({error:'Expected a Git packed-object batch'},415);
 const objects=unpack(await readGitBody(request),repositoryLimits(env));
 await env.PACKER.get(env.PACKER.idFromName(trunk)).publishGit(trunk,[...objects.values()].map(object=>encode(object.type,object.body)));
 return json({stored:objects.size,refsPublished:false});
}
