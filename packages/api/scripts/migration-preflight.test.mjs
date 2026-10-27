import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {migrate} from '../../../tools/migrate-repository.mjs';
const exec=promisify(execFile);
async function source(){
 const dir=await mkdtemp(join(tmpdir(),'nh-import-preflight-'));
 const git=async(...args)=>(await exec('git',['-C',dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args])).stdout;
 await git('init','-b','main');await writeFile(join(dir,'README.md'),'committed fixture\n');await git('add','.');await git('commit','-m','Initial');
 return {dir,git,close:()=>rm(dir,{recursive:true,force:true})};
}
test('a receiver without large-initial-import support refuses before any object upload',async t=>{
 const f=await source();try{
  const sha=(await f.git('rev-parse','HEAD')).trim();
  for(let i=0;i<101;i++)await f.git('update-ref',`refs/heads/import/${i}`,sha);
  const before=await f.git('show-ref');let reads=0,writes=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{if(options?.method==='POST')writes++;else reads++;return Response.json({protocol:'nanohub-git-import-v1',mode:'git',refs:[],defaultBranch:'main',writable:true});});
  await assert.rejects(migrate(f.dir,'https://nanohub.sh/git/fixture.git','migration','fixture-key'),/at most 100 initial refs; no objects uploaded/);
  assert.equal(reads,1);assert.equal(writes,0);assert.equal(await f.git('show-ref'),before);
 }finally{await f.close();}
});
test('a shallow source cannot be described as a complete migration or touch a receiver',async t=>{
 const f=await source();const copy=f.dir+'-shallow.git';try{
  await exec('git',['clone','--bare','--depth=1',pathToFileURL(f.dir).href,copy]);let calls=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('unexpected receiver access');});
  await assert.rejects(migrate(copy,'https://nanohub.sh/git/fixture.git','migration','fixture-key'),/Fetch complete history/);
  assert.equal(calls,0);
 }finally{await rm(copy,{recursive:true,force:true});await f.close();}
});
test('only immutable uploads retry rate limits, unavailability and ambiguous acknowledgements; errors redact credentials',async()=>{
 const f=await source();try{
  const token='nhg_'+'a'.repeat(48),payloads=[],delays=[];let calls=0,publications=0;
  const fetcher=async(url,options)=>{
   assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
   if(url.endsWith('/nanohub-import'))return Response.json({protocol:'nanohub-git-import-v1',mode:'git',refs:[],defaultBranch:'main',writable:true,initialImportMaxRefs:10000});
   if(url.endsWith('/git-receive-pack'))publications++;
   payloads.push(Buffer.from(options.body));calls++;
   if(calls===1)return new Response('',{status:429,headers:{'Retry-After':'900'}});
   if(calls===2)return new Response('',{status:503});
   if(calls===3)throw Error('A hostile transport error echoed '+token);
   return Response.json({error:token+' '+Buffer.from('git:'+token).toString('base64')},{status:400});
  };
  let error;try{await migrate(f.dir,'https://nanohub.sh/git/fixture.git','git',token,()=>{},{fetcher,sleep:async ms=>delays.push(ms)});}catch(value){error=value;}
  assert.match(String(error),/Object upload failed/);assert.ok(!String(error).includes(token));assert.ok(!String(error).includes(Buffer.from('git:'+token).toString('base64')));assert.equal(calls,4);assert.equal(publications,0);assert.deepEqual(delays,[60000,2000,1500]);for(const payload of payloads)assert.deepEqual(payload,payloads[0]);
 }finally{await f.close();}
});
test('a lost ref-publication response is never automatically replayed',async()=>{
 const f=await source();try{
  let publications=0;
  const fetcher=async(url)=>{
   if(url.endsWith('/nanohub-import'))return Response.json({protocol:'nanohub-git-import-v1',mode:'git',refs:[],defaultBranch:'main',writable:true,initialImportMaxRefs:10000});
   if(url.endsWith('/nanohub-import/objects'))return Response.json({stored:3,refsPublished:false});
   publications++;throw Error('lost after commit');
  };
  await assert.rejects(migrate(f.dir,'https://nanohub.sh/git/fixture.git','git','fixture-key',()=>{},{fetcher}),/Ref publication response was lost/);assert.equal(publications,1);
 }finally{await f.close();}
});
test('verification clone rejects a different HTTP object alternate before sending any request there',async()=>{
 const f=await source(),servers=[];try{
  const sha=(await f.git('rev-parse','HEAD')).trim(),seen=[];
  const serve=async handler=>{const server=createServer(handler);servers.push(server);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;};
  const alternate=await serve(async(request,response)=>{
   seen.push({alternate:true,authorization:request.headers.authorization});const path=new URL(request.url,'http://fixture').pathname.match(/^\/git\/fixture.git\/objects\/([a-f0-9]{2})\/([a-f0-9]{38})$/);
   if(!path){response.writeHead(404).end();return;}try{response.end(await readFile(join(f.dir,'.git','objects',path[1],path[2])));}catch{response.writeHead(404).end();}
  });
  const origin=await serve((request,response)=>{
   seen.push({alternate:false,authorization:request.headers.authorization});const path=new URL(request.url,'http://fixture').pathname;
   if(path.endsWith('/nanohub-import')){response.setHeader('Content-Type','application/json');response.end(JSON.stringify({protocol:'nanohub-git-import-v1',mode:'git',refs:[{name:'refs/heads/main',commit:sha}],defaultBranch:'main',writable:true,initialImportMaxRefs:10000}));}
   else if(path.endsWith('/info/refs'))response.end(`${sha}\trefs/heads/main\n`);
   else if(path.endsWith('/HEAD'))response.end('ref: refs/heads/main\n');
   else if(path.endsWith('/objects/info/packs'))response.end('\n');
   else if(path.endsWith('/objects/info/http-alternates'))response.end(alternate+'/git/fixture.git/objects\n');
   else response.writeHead(404).end();
  });
  await assert.rejects(migrate(f.dir,origin+'/git/fixture.git','git','fixture-key'),/alternate disabled by http.followRedirects/);assert.ok(seen.some(request=>!request.alternate&&request.authorization));assert.equal(seen.filter(request=>request.alternate).length,0,'the alternate must receive neither requests nor credentials');
 }finally{for(const server of servers)await new Promise(resolve=>server.close(resolve));await f.close();}
});
