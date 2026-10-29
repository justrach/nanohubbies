import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture,ROOM} from './team/fixture.ts';
const f=await teamFixture({ACTIONS_MAX_SANDBOXES:'3',ACTIONS_MAX_SANDBOXES_PER_ACCOUNT:'2'}),exec=promisify(execFile);
const auth=(runner:{token:string})=>({Authorization:'Bearer '+runner.token});
const environment={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
try {
 const owner=await f.login('owner','101'),other=await f.login('other','202');f.members.set('202','owner');
 const source=join(f.dir,'source');await mkdir(source);await writeFile(join(source,'README.md'),'Capacity fixture\n');
 const git=async(...args:string[])=>exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:environment});
 await git('init','-b','main');await git('add','.');await git('commit','-m','Seed capacity fixture');
 const repos:Record<string,any>={};
 for(const [trunk,cookie,team] of [['capacity-a',owner,false],['capacity-b',owner,false],['capacity-c',other,false],['capacity-d',owner,true],['capacity-e',other,true]] as const) {
  const base='/api/trunks/'+trunk;await f.json('POST',base,{mode:'git'},cookie);
  if(team)await f.json('POST',base+'/team',{roomId:ROOM},cookie);
  const runner=await f.json('POST',base+'/ci/runners',{name:'controller-one'},cookie),key=await f.json('POST',base+'/git-tokens',{label:'capacity fixture'},cookie);
  await exec('git',['-C',source,'push',f.origin+'/git/'+trunk+'.git','main'],{env:{...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)}});
  const claimed=await f.json('POST',base+'/ci/claim',{},auth(runner));assert.ok(claimed.run);
  repos[trunk]={base,cookie,runner,run:claimed.run};
 }
 const a=repos['capacity-a'],b=repos['capacity-b'],c=repos['capacity-c'],d=repos['capacity-d'],e=repos['capacity-e'];
 const call=(repo:any,operation:string,body:any={})=>f.json('POST',repo.base+'/ci/capacity/'+operation,body,auth(repo.runner));
 const request=(repo:any,job:string)=>({id:randomUUID(),runId:repo.run.id,attempt:repo.run.attempt,job:'checks/'+job});
 const status=await call(a,'status');assert.equal(status.sharedReservations,'v1');assert.deepEqual(status.limits,{total:3,perAccount:2});
 await f.json('POST','/api/namespaces',{name:'capacity-owner'},owner);await f.json('POST','/api/repository-addresses/capacity-a',{namespace:'capacity-owner',name:'before'},owner);await f.json('POST','/api/repos/capacity-owner/before/address',{name:'after'},owner);
 assert.deepEqual((await f.json('POST','/api/repos/capacity-owner/before/ci/capacity/status',{},auth(a.runner))).usage,{total:0,account:0});
 const requests=Array.from({length:24},(_,i)=>{const repo=i%2?a:b;return {repo,body:request(repo,'test'+i)};});
 // Different repository Sequencers and simultaneous HTTP workers must all
 // serialize at the shared Hub, rather than count independently in JS.
 const outcomes=await Promise.all(requests.map(async entry=>({...entry,result:await call(entry.repo,'reserve',entry.body)})));
 const accepted=outcomes.filter(entry=>entry.result.admitted);assert.equal(accepted.length,2);assert.deepEqual((await call(b,'status')).usage,{total:2,account:2});
 const third=request(c,'other');assert.equal((await call(c,'reserve',third)).admitted,true);
 assert.equal((await call(d,'reserve',request(d,'full'))).admitted,false);
 const first=accepted[0];assert.equal((await call(first.repo,'reserve',first.body)).reservation.id,first.body.id);assert.equal((await call(a,'status')).usage.total,3);
 assert.deepEqual((await f.json('POST','/api/repos/capacity-owner/after/ci/capacity/status',{},auth(a.runner))).usage,{total:3,account:2});
 assert.equal((await f.request('POST',a.base+'/ci/capacity/reserve',{...request(a,'spoof'),account:'other',limit:1000},auth(a.runner))).status,403);
 assert.equal((await f.request('POST',a.base+'/ci/capacity/reserve',{...request(a,'stale'),attempt:0},auth(a.runner))).status,403);
 assert.equal((await f.request('POST',c.base+'/ci/capacity/inspect',{id:first.body.id},auth(c.runner))).status,403);
 assert.equal((await f.request('POST',a.base+'/ci/capacity/status',{},auth(c.runner))).status,403);
 for(const entry of accepted)await call(entry.repo,'release',{id:entry.body.id,reason:'not-created'});
 const teamOne=request(d,'teamOne'),teamTwo=request(e,'teamTwo');assert.equal((await call(d,'reserve',teamOne)).admitted,true);assert.equal((await call(e,'reserve',teamTwo)).admitted,true);
 assert.deepEqual((await call(d,'status')).usage,{total:3,account:2});assert.deepEqual((await call(e,'status')).usage,{total:3,account:2});
 await call(c,'release',{id:third.id,reason:'destroyed',sandboxId:'box-lost-attach'});
 assert.equal((await call(e,'reserve',request(e,'teamFull'))).admitted,false);
 await call(d,'attach',{id:teamOne.id,sandboxId:'box-one'});
 assert.equal((await f.request('POST',d.base+'/ci/capacity/release',{id:teamOne.id,reason:'destroyed',sandboxId:'box-wrong'},auth(d.runner))).status,403);
 await f.restart();assert.deepEqual((await call(e,'status')).usage,{total:2,account:2});assert.equal((await call(d,'inspect',{id:teamOne.id})).sandboxId,'box-one');
 // A revoked runner cannot free quota. A replacement controller can finish
 // cleanup after the lease is canceled by archive; neither action expires it.
 const replacement=await f.json('POST',d.base+'/ci/runners',{name:'replacement'},d.cookie);
 await f.json('DELETE',d.base+'/ci/'+d.runner.id,undefined,d.cookie);
 assert.equal((await f.request('POST',d.base+'/ci/capacity/release',{id:teamOne.id,reason:'destroyed',sandboxId:'box-one'},auth(d.runner))).status,403);
 await f.json('POST',d.base+'/archive',{archived:true,revision:0,confirmation:'capacity-d'},d.cookie);
 const retired=d.runner;d.runner=replacement;assert.equal((await call(d,'inspect',{id:teamOne.id})).state,'allocated');assert.deepEqual((await call(d,'status')).usage,{total:2,account:2});
 assert.equal((await f.request('POST',d.base+'/ci/capacity/reserve',request(d,'archived'),auth(replacement))).status,403);
 await call(d,'release',{id:teamOne.id,reason:'destroyed',sandboxId:'box-one'});await call(e,'release',{id:teamTwo.id,reason:'not-created'});
 assert.deepEqual((await call(e,'status')).usage,{total:0,account:0});assert.equal((await call(d,'inspect',{id:teamOne.id})).state,'released');
 const configPath=join(f.dir,"Repair config's file.json"),receiptPath=join(f.dir,'job.capacity.json');
 await writeFile(configPath,JSON.stringify({origin:f.origin,trunk:'capacity-d',tokenEnv:'NANOHUB_CI_TOKEN'}));await writeFile(receiptPath,JSON.stringify({...teamOne,sandboxId:'box-one',state:'release-pending'}));
 const repair=await exec('bun',[resolve(import.meta.dirname,'../../../tools/reconcile-sandbox-capacity.mjs'),configPath,receiptPath,'--release'],{env:{...environment,NANOHUB_CI_TOKEN:replacement.token,CODEGRAFF_API_KEY:'synthetic-unused-key'}});
 assert.equal(JSON.parse(repair.stdout).alreadyReleased,true);assert.ok(!repair.stdout.includes(replacement.token));d.runner=retired;
 console.log('PASS: shared Actions reservations across simultaneous repository workers; owner/team and deployment limits, replay fencing, server-owned policy, cross-repository isolation, durable restart, revocation and cleanup after archive');
}finally{await f.close();}
