import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture(),trunk='check-conclusions-git',base=`/api/trunks/${trunk}`,exec=promisify(execFile),runners:any[]=[],keys:any[]=[];
let owner:any;
try{
 owner=await f.login('author','101');await f.json('POST',base,{mode:'git'},owner);
 const source=join(f.dir,'source');await mkdir(source);const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'},git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env})).stdout.trim();
 const key=await f.json('POST',base+'/git-tokens',{label:'Conclusions fixture'},owner);keys.push(key);const remote=f.origin+`/git/${trunk}.git`,transport=async(...args:string[])=>exec('git',['-C',source,...args],{env:{...env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+key.token)}});
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Base\n');await git('add','.');await git('commit','-m','Base');const anchor=await git('rev-parse','HEAD');await transport('push',remote,'main');await git('checkout','-b','feature');await writeFile(join(source,'README.md'),'Check conclusions fixture\n');await git('commit','-am','Candidate');const head=await git('rev-parse','HEAD');await transport('push',remote,'feature');
 const trusted=await f.json('POST',base+'/ci/runners',{name:'trusted'},owner),other=await f.json('POST',base+'/ci/runners',{name:'other'},owner);runners.push(trusted,other);const auth=(runner:any)=>({authorization:'Bearer '+runner.token});
 const policy={branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:['test'],checkSources:[{name:'test',runner:trusted.id}],preventForce:true,preventDelete:true};await f.json('PUT',base+'/protection',policy,owner);
 const result=(state:string,name='test')=>({name,state,command:'Trusted synthetic check conclusion',log:'',artifacts:[]});
 let id:string;
 const deliver=async(state:string,runner=trusted,name='test')=>{
  if(id)await f.json('POST',base+'/ci/retry',{runId:id},owner);
  let run=(await f.json('POST',base+'/ci/claim',{},auth(runner))).run;
  while(run&&run.head!==head){await f.json('POST',base+'/ci/runs/'+run.id,{attempt:run.attempt,results:[],staging:null},auth(runner));run=(await f.json('POST',base+'/ci/claim',{},auth(runner))).run;}
  assert.ok(run);id=run.id;const body={attempt:run.attempt,results:[result(state,name)],staging:null};
  for(const bad of [{...body,results:[result('running')]},{...body,results:[result(state,name),result(state,name)]},{...body,results:[{...result(state,name),source:trusted.id}]}])assert.equal((await f.request('POST',base+'/ci/runs/'+run.id,bad,auth(runner))).status,403);
  assert.equal((await f.request('POST',base+'/ci/runs/'+run.id,body,{authorization:'Bearer '+key.token})).status,401);
  const completed=await f.json('POST',base+'/ci/runs/'+run.id,body,auth(runner));assert.deepEqual(await f.json('POST',base+'/ci/runs/'+run.id,body,auth(runner)),completed);return run;
 };
 const open={title:'Check conclusion gates',head:'feature'},merge={commit:head,anchor};
 await deliver('skipped',other);let denied=await f.request('POST',base+'/pulls',open,owner);assert.equal(denied.status,400);assert.match((await denied.json()).error,/must be reported by trusted/);
 await deliver('neutral');await f.json('POST',base+'/pulls',open,owner);
 const unchanged=async()=>{const view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.pull.state,'open');assert.equal(view.branches.find((b:any)=>b.name==='main').commit,anchor);assert.equal(view.head.commit,head);return view;};
 const cli=await f.json('POST',base+'/cli-credentials',{label:'Conclusion CLI fixture',scopes:['read'],days:1},owner);keys.push(cli);
 const runCli=async(json=false)=>exec('bun',[new URL('../../cli/bin/nh.mjs',import.meta.url).pathname,'run','list','--host',f.origin,'--trunk',trunk,...(json?['--json']:[])],{cwd:f.dir,env:{...env,NANOHUB_API_TOKEN:cli.token}});
 assert.match((await runCli()).stdout,/complete \/ neutral/);assert.equal(JSON.parse((await runCli(true)).stdout).runs.find((r:any)=>r.id===id).results[0].state,'neutral');
 for(const state of ['failure','cancelled','timed_out','action_required','stale']){
  await deliver(state);denied=await f.request('POST',base+'/pulls/1/merge',merge,owner);assert.equal(denied.status,400);assert.match((await denied.json()).error,new RegExp(state));await unchanged();assert.match((await runCli()).stdout,new RegExp('complete / '+state));
 }
 await deliver('skipped',other);assert.equal((await f.request('POST',base+'/pulls/1/merge',merge,owner)).status,400);await unchanged();
 await deliver('skipped',trusted,'unrequired');assert.equal((await f.request('POST',base+'/pulls/1/merge',merge,owner)).status,400);await unchanged();
 // The reserved staging check still means an actual verified deployment.
 await deliver('skipped',trusted,'staging');await f.json('PUT',base+'/protection',{...policy,checks:['staging'],beforeOpen:[],checkSources:[]},owner);assert.equal((await f.request('POST',base+'/pulls/1/merge',merge,owner)).status,400);await unchanged();
 await f.json('PUT',base+'/protection',policy,owner);await deliver('skipped');assert.match((await runCli()).stdout,/complete \/ skipped/);await f.restart();await unchanged();await f.json('POST',base+'/pulls/1/merge',merge,owner);
 const clone=join(f.dir,'clone');await transport('clone',remote,clone);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'],{env})).stdout.trim(),head);await exec('git',['-C',clone,'fsck','--strict'],{env});
 console.log('PASS: real Worker/Git neutral before-open checks and skipped merge, all five blocking conclusions, current source pins, ordinary-token/source/unknown/duplicate spoof rejection, named/staging evidence requirements, callback idempotence, native Bun CLI text/JSON, restart persistence and exact clone/fsck');
}finally{if(owner){for(const runner of runners)await f.request('DELETE',base+'/ci/'+runner.id,undefined,owner).catch(()=>{});for(const key of keys)await f.request('DELETE','/api/tokens/'+key.id,undefined,owner).catch(()=>{});}await f.close();}
