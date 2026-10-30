import {test,expect} from 'bun:test';
import {mkdtemp,rm,readFile,stat,writeFile,chmod,symlink,mkdir,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {run} from '../src/main.mjs';import {apiRequest} from '../src/api.mjs';
const apiToken='nhc_'+'c'.repeat(64),credentialId='11111111-1111-4111-8111-111111111111';
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'nh-secret-cli-')),requests=[],output=[],grants=new Map();let lost=false,created=0,archived=false,old=false,expiry=Date.now()+3600000;
 const io={cwd:dir,platform:'darwin',environment:{NANOHUB_API_TOKEN:apiToken},write:value=>output.push(value),execute:async()=>({code:1,stdout:'',stderr:''}),fetcher:async(url,options)=>{
  requests.push({url,options});const path=new URL(url).pathname;
  if(options.method==='GET')return Response.json({conditionalWrites:!old,clientGrants:old?undefined:'v1',revisionTracking:'storage',revision:1,repositoryId:'repo-id',secrets:[],grants:[],readOnly:archived,serverTime:Date.now(),delegationId:credentialId,delegationExpiresAt:expiry});
  if(options.method==='DELETE'&&path.includes('/grants/')){const id=path.split('/').at(-1);grants.get(id).revoked=true;return Response.json({id,revoked:true});}
  if(options.method==='POST'){
   const input=JSON.parse(options.body);let grant=grants.get(input.id);if(grant?.revoked)return Response.json({error:'revoked '+input.token},{status:409});if(!grant){grant={...input,created:true};grants.set(input.id,grant);created++;}else grant={...grant,created:false};
   if(lost){lost=false;throw Error('lost '+input.token);}return Response.json({grant:{...grant,token:input.token},token:input.token});
  }
  const name=path.split('/').at(-1);return Response.json(options.method==='PUT'?{secret:{name,binding:JSON.parse(options.body).binding},revision:2}:{disconnected:true,valueRetainedByCloudflare:true,revision:2});
 }};
 return{dir,requests,output,io,grants,get created(){return created;},loseNext(){lost=true;},archive(){archived=true;},oldReceiver(){old=true;},shortExpiry(){expiry=Date.now()+30000;},close:()=>rm(dir,{recursive:true,force:true})};
}
const command=(f,...args)=>run(['secret',...args,'-R','owner/repo','--json'],f.io);
test('grant credential is owner-only and durable before POST, and never appears in output or errors',async()=>{
 const f=await fixture();try{const file=join(f.dir,"Workload's credential.json"),fetcher=f.io.fetcher;f.io.fetcher=async(url,options)=>{if(options.method==='POST'){expect((await stat(file)).mode&0o077).toBe(0);expect(JSON.parse(await readFile(file,'utf8')).token).toBe(JSON.parse(options.body).token);expect(options.headers['If-Match']).toBe('"secrets-1"');}return fetcher(url,options);};await command(f,'grant','TOKEN','--revision','1','--token-file',file);const saved=JSON.parse(await readFile(file,'utf8'));expect(saved.token).toMatch(/^nhw_[a-f0-9]{64}$/);expect(saved.credentialId).toBe(credentialId);expect(f.output.join('')).not.toContain(saved.token);expect(f.output.join('')).not.toContain(apiToken);await expect(command(f,'grant','TOKEN','--revision','1','--token-file',file)).rejects.toThrow('never overwritten');expect(f.created).toBe(1);expect(JSON.parse(await readFile(file,'utf8'))).toEqual(saved);}finally{await f.close();}
});
test('lost acknowledgement recovers the exact fixed-expiry grant, and revoked grants cannot return',async()=>{
 const f=await fixture();try{const file=join(f.dir,'grant.json');f.loseNext();await expect(command(f,'grant','TOKEN','--revision','1','--token-file',file)).rejects.toThrow('secret recover');const saved=JSON.parse(await readFile(file,'utf8'));await command(f,'recover','--token-file',file);const posts=f.requests.filter(r=>r.options.method==='POST');expect(posts.length).toBe(2);expect(JSON.parse(posts[0].options.body)).toEqual(JSON.parse(posts[1].options.body));expect(f.created).toBe(1);await command(f,'revoke',saved.id,'--confirm',saved.id);let error;try{await command(f,'recover','--token-file',file);}catch(e){error=e;}expect(String(error)).toContain('revoked [redacted]');expect(String(error)).not.toContain(saved.token);expect(f.created).toBe(1);}finally{await f.close();}
});
test('private file validation prevents cross-host, repository, environment, permission and symlink recovery',async()=>{
 const f=await fixture();try{const file=join(f.dir,'grant.json');await command(f,'grant','TOKEN','--revision','1','--token-file',file);const original=await readFile(file,'utf8'),posts=()=>f.requests.filter(r=>r.options.method==='POST').length,before=posts();await chmod(file,0o644);await expect(command(f,'recover','--token-file',file)).rejects.toThrow('owner-only');await chmod(file,0o600);const link=join(f.dir,'link.json');await symlink(file,link);await expect(command(f,'recover','--token-file',link)).rejects.toThrow('private workload');for(const change of [{origin:'https://other.invalid'},{repository:'other/repo'},{environment:'production'},{credentialId:'22222222-2222-4222-8222-222222222222'},{value:'not-allowed'}]){await writeFile(file,JSON.stringify({...JSON.parse(original),...change}));await expect(command(f,'recover','--token-file',file)).rejects.toThrow();}await writeFile(file,' '.repeat(32769));await expect(command(f,'recover','--token-file',file)).rejects.toThrow('private workload');expect(posts()).toBe(before);}finally{await f.close();}
});
test('all 100 long secret names fit the bounded grant file and recover without truncation',async()=>{
 const f=await fixture();try{const file=join(f.dir,'many.json'),names=Array.from({length:100},(_,i)=>'N'+String(i).padStart(3,'0')+'X'.repeat(124));await command(f,'grant',...names,'--revision','1','--token-file',file);expect((await stat(file)).size).toBeGreaterThan(4096);expect((await stat(file)).size).toBeLessThan(32768);await command(f,'recover','--token-file',file);expect(JSON.parse(f.output.at(-1)).grant.names).toEqual(names);}finally{await f.close();}
});
test('grant files cannot enter a Git checkout, including through parent symlinks',async()=>{
 const f=await fixture();try{const checkout=join(f.dir,'repo');await mkdir(checkout);await mkdir(join(checkout,'.git'));const alias=join(f.dir,'alias');await symlink(checkout,alias);for(const parent of [checkout,alias]){const file=join(parent,'grant.json');await expect(command(f,'grant','TOKEN','--revision','1','--token-file',file)).rejects.toThrow('outside Git');await expect(access(file)).rejects.toThrow();}expect(f.requests.length).toBe(0);}finally{await f.close();}
});
test('old receivers, archived repositories and expiring parent delegations stop before credential creation',async()=>{
 for(const mode of ['oldReceiver','archive','shortExpiry']){const f=await fixture();try{f[mode]();const file=join(f.dir,'grant.json');await expect(command(f,'grant','TOKEN','--revision','1','--token-file',file)).rejects.toThrow();await expect(access(file)).rejects.toThrow();expect(f.created).toBe(0);}finally{await f.close();}}
});
test('reference edits use explicit revisions and secret errors redact workload credentials',async()=>{
 const f=await fixture();try{await command(f,'connect','TOKEN','--binding','CF_TOKEN','--revision','1','--environment','production');const call=f.requests.find(r=>r.options.method==='PUT');expect(new URL(call.url).searchParams.get('environment')).toBe('production');expect(call.options.headers['If-Match']).toBe('"secrets-1"');expect(JSON.parse(call.options.body)).toEqual({binding:'CF_TOKEN'});await expect(command(f,'disconnect','TOKEN','--revision','1','--confirm','other')).rejects.toThrow('confirm');await expect(command(f,'grant','TOKEN','--revision','1','--token-file',join(f.dir,'bad.json'),'--ttl','59')).rejects.toThrow('--ttl');const secret='nhw_'+'e'.repeat(64);await expect(apiRequest('https://nanohub.sh','/api/cli/trunks/repo/secrets',apiToken,{fetcher:async()=>Response.json({error:'private '+secret},{status:403})})).rejects.toThrow('private [redacted]');}finally{await f.close();}
});
