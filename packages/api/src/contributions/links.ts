import {ObjectReader} from '../objects';
import {isAncestor} from '../repository/validate';
import type {WorkLink} from './types';
/** Verify links against this repository. A self-reported link is still not
 * evidence that the agent authored a commit or supplied an eligible review. */
export async function verifyWorkLinks(env:Env,trunk:string,links:WorkLink[]) {
 const seq=env.SEQUENCER.get(env.SEQUENCER.idFromName(trunk));
 const reader=new ObjectReader(env.OBJECTS,trunk,async()=>(await env.PACKER.get(env.PACKER.idFromName(trunk)).list()).packs);
 let reads=0,bytes=0;const cache=new Map<string,NonNullable<Awaited<ReturnType<typeof reader.get>>>>();
 const get=async(sha:string)=>{if(cache.has(sha))return cache.get(sha)!;const obj=await reader.get(sha);if(++reads>4000||(bytes+=obj?.body.length??0)>16*1024*1024)throw Error('Work-link verification limit exceeded; link a published branch tip or pull request');if(obj?.type==='commit'||obj?.type==='tag')cache.set(sha,obj);return obj;};
 for(const link of links){
  if(link.kind==='pull'){if(!await seq.contributionPullExists(link.number))throw Error('Pull request is not in this repository');continue;}
  if((await get(link.sha))?.type!=='commit')throw Error('Commit is not in this repository');
  if(await seq.contributionLinkKnown(link.sha))continue;
  let found=false;for(const ref of await seq.repositoryRefs()){
   let root=ref.commit;const seen=new Set<string>();let obj=await get(root);
   while(obj?.type==='tag'){if(seen.size>=20||seen.has(root))throw Error('Work-link tag traversal limit exceeded');seen.add(root);const next=/^object ([a-f0-9]{40})$/m.exec(new TextDecoder().decode(obj.body).split('\n\n')[0])?.[1];if(!next)break;root=next;obj=await get(root);}
   if(obj?.type==='commit'&&await isAncestor(get,link.sha,root)){found=true;break;}
  }if(!found)throw Error('Commit has not been published in this repository');
 }
}
