import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
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
  t.mock.method(globalThis,'fetch',async(_url,options)=>{if(options?.method==='POST')writes++;else reads++;return Response.json({mode:'git',refs:[],defaultBranch:'main'});});
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
