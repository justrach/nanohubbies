import {test,expect} from 'bun:test';
import {mkdtemp,rm,readFile,stat,chmod,symlink,writeFile,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from '../src/main.mjs';
import {apiRequest} from '../src/api.mjs';
const token='nhc_'+'c'.repeat(64);
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'nh-collaborators-')),requests=[],output=[],invitations=new Map(),retired=new Set();let revision=0,lose=false;
 const state=()=>({trunk:'repo-id',members:[{userId:'codegraff:owner',role:'owner'}],invitations:[...invitations.values()].map(({token,...invitation})=>invitation),revision,currentRole:'owner',readOnly:false,canManage:true,conditionalWrites:true,revisionTracking:'storage',clientInvitations:'v1',audit:[]});
 const io={cwd:dir,environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),execute:async()=>({code:1,stdout:'',stderr:''}),fetcher:async(url,options)=>{
  requests.push({url,options});if(options.method==='GET')return Response.json(state());const body=JSON.parse(options.body);expect(options.headers['If-Match']).toBe(`"collaborators-${body.revision}"`);
  if(options.method==='POST'){
   if(retired.has(body.id))return Response.json({error:'Invitation is no longer available'},{status:409});
   if(!invitations.has(body.id)){invitations.set(body.id,{id:body.id,userId:body.userId,role:body.role,token:body.token,expires:Date.now()+600000});revision++;}
   if(lose){lose=false;throw Error('lost '+body.token);}
   const {token:secret,...invitation}=invitations.get(body.id);return Response.json({...state(),invitation});
  }
  revision++;if(options.method==='DELETE'){invitations.delete(body.id);retired.add(body.id);}return Response.json(state());
 }};
 return {dir,requests,output,io,invitations,retired,loseNext(){lose=true;},advance(){revision++;},close:()=>rm(dir,{recursive:true,force:true})};
}
test('invitation is saved privately before POST with a recipient-bound fragment link; output contains no token',async()=>{
 const f=await fixture();try {
  const file=join(f.dir,"Invitation's file.json"),original=f.io.fetcher;f.io.fetcher=async(url,options)=>{if(options.method==='POST'){expect((await stat(file)).mode&0o077).toBe(0);expect(JSON.parse(await readFile(file,'utf8')).token).toBe(JSON.parse(options.body).token);}return original(url,options);};
  await run(['access','invite','codegraff:reader','--role','reader','--invite-file',file,'--revision','0','-R','owner/repo','--json'],f.io);
  const saved=JSON.parse(await readFile(file,'utf8'));expect(saved.acceptUrl).toBe('https://nanohub.sh/invite#'+new URLSearchParams({trunk:'repo-id',token:saved.token}));expect(saved.token).toMatch(/^nhi_[a-f0-9]{64}$/);expect(f.output.join('')).not.toContain(saved.token);expect(f.output.join('')).not.toContain(token);expect(f.invitations.size).toBe(1);
  await expect(run(['access','invite','codegraff:other','--role','writer','--invite-file',file,'--revision','1','-R','owner/repo'],f.io)).rejects.toThrow('never overwritten');expect(f.invitations.size).toBe(1);
 }finally{await f.close();}
});
test('lost invitation acknowledgement recovers the same ID/token, and canceled invitations never recover',async()=>{
 const f=await fixture();try {
  const file=join(f.dir,'invite.json');f.loseNext();let error;try{await run(['access','invite','codegraff:reader','--role','reader','--invite-file',file,'--revision','0','-R','owner/repo'],f.io);}catch(e){error=e;}
  const saved=JSON.parse(await readFile(file,'utf8'));expect(String(error)).toContain('access recover');expect(String(error)).not.toContain(saved.token);expect(f.invitations.size).toBe(1);
  await run(['access','recover','--invite-file',file,'-R','owner/repo'],f.io);const posts=f.requests.filter(r=>r.options.method==='POST');expect(JSON.parse(posts[0].options.body).id).toBe(JSON.parse(posts[1].options.body).id);expect(f.invitations.size).toBe(1);
  await run(['access','cancel',saved.id,'--confirm',saved.id,'--revision','1','-R','owner/repo'],f.io);await expect(run(['access','recover','--invite-file',file,'-R','owner/repo'],f.io)).rejects.toThrow('no longer available');expect(f.invitations.size).toBe(0);
 }finally{await f.close();}
});
test('readable-by-others, symlinked, oversized, cross-host/repository and checkout invitation files cannot be used',async()=>{
 const f=await fixture();try {
  const file=join(f.dir,'invite.json');await run(['access','invite','codegraff:reader','--role','reader','--invite-file',file,'--revision','0','-R','owner/repo'],f.io);const text=await readFile(file,'utf8'),before=f.requests.length;
  await chmod(file,0o644);await expect(run(['access','recover','--invite-file',file,'-R','owner/repo'],f.io)).rejects.toThrow('owner-only');await chmod(file,0o600);
  const link=join(f.dir,'link.json');await symlink(file,link);await expect(run(['access','recover','--invite-file',link,'-R','owner/repo'],f.io)).rejects.toThrow('private invitation');
  await writeFile(file,'x'.repeat(4097));await expect(run(['access','recover','--invite-file',file,'-R','owner/repo'],f.io)).rejects.toThrow('private invitation');await writeFile(file,text);
  await expect(run(['access','recover','--invite-file',file,'-R','other/repo'],f.io)).rejects.toThrow('private invitation');await expect(run(['access','recover','--invite-file',file,'-R','owner/repo','--host','https://other.invalid'],f.io)).rejects.toThrow('private invitation');expect(f.requests.length).toBe(before);
  const checkout=join(f.dir,'checkout');await mkdir(checkout);await mkdir(join(checkout,'.git'));await expect(run(['access','invite','codegraff:new','--role','reader','--invite-file',join(checkout,'invite.json'),'--revision','1','-R','owner/repo'],f.io)).rejects.toThrow('outside Git');
 }finally{await f.close();}
});
test('edits require the observed revision, destructive actions require exact confirmation, and missing capability creates no file',async()=>{
 const f=await fixture();try {
  for(const args of [['role','codegraff:reader','--role','writer'],['remove','codegraff:reader','--revision','0'],['invite','codegraff:reader','--role','owner','--invite-file',join(f.dir,'bad.json'),'--revision','0']])await expect(run(['access',...args,'-R','owner/repo'],f.io)).rejects.toThrow();expect(f.requests.length).toBe(0);
  f.advance();await expect(run(['access','role','codegraff:reader','--role','writer','--revision','0','-R','owner/repo'],f.io)).rejects.toThrow('access changed');expect(f.requests.filter(r=>r.options.method!=='GET').length).toBe(0);
  const file=join(f.dir,'invite.json');f.io.fetcher=async()=>Response.json({members:[],invitations:[]});await expect(run(['access','invite','codegraff:new','--role','writer','--invite-file',file,'--revision','1','-R','owner/repo'],f.io)).rejects.toThrow('updating');await expect(access(file)).rejects.toThrow();
  await expect(apiRequest('https://nanohub.sh','/api/cli/trunks/repo/collaborators',token,{fetcher:async()=>Response.json({error:'secret nhi_'+'e'.repeat(64)},{status:403})})).rejects.toThrow('secret [redacted]');
 }finally{await f.close();}
});
