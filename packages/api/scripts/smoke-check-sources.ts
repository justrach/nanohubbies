import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {teamFixture} from './team/fixture.ts';

const f=await teamFixture(),exec=promisify(execFile),trunk='check-sources-git',base=`/api/trunks/${trunk}`;
let owner:any,gitToken:any;const runners:{id:string;token:string}[]=[];
try {
 owner=await f.login('author','101');const writer=await f.login('reviewer','202'),reader=await f.login('reader','303'),admin=await f.login('admin','404');
 await f.json('POST',base,{mode:'git'},owner);
 for(const [id,who,role] of [['reviewer',writer,'writer'],['reader',reader,'reader'],['admin',admin,'admin']] as const){const invite=await f.json('POST',`${base}/collaborators`,{userId:`codegraff:${id}`,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invite.token},who);}
 const source=join(f.dir,'source');await mkdir(source);const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args])).stdout.trim();
 await git('init','-b','main');await writeFile(join(source,'README.md'),'Base\n');await git('add','.');await git('commit','-m','Base');const anchor=await git('rev-parse','HEAD');
 gitToken=await f.json('POST',`${base}/git-tokens`,{label:'Check source Git fixture'},owner);const remote=`${f.origin}/git/${trunk}.git`,transport=async(...args:string[])=>exec('git',['-C',source,...args],{env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: Basic ${btoa(`git:${gitToken.token}`)}`}});
 await transport('push',remote,'main');await git('checkout','-b','feature');await writeFile(join(source,'README.md'),'Reviewed candidate\n');await git('add','.');await git('commit','-m','Candidate');const head=await git('rev-parse','HEAD');await transport('push',remote,'feature');await git('fsck','--strict');
 const trusted=await f.json('POST',`${base}/ci/runners`,{name:'shared-pool'},owner),other=await f.json('POST',`${base}/ci/runners`,{name:'shared-pool'},owner);runners.push(trusted,other);
 const auth=(runner:any)=>({authorization:`Bearer ${runner.token}`}),pin=[{name:'test',runner:trusted.id}],policy={branch:'main',pullRequest:true,approvals:0,checks:['test'],beforeOpen:['test'],checkSources:pin,preventForce:true,preventDelete:true};
 assert.equal((await f.request('PUT',`${base}/protection`,policy,writer)).status,403);assert.equal((await f.request('PUT',`${base}/protection`,policy,reader)).status,403);assert.equal((await f.request('PUT',`${base}/protection`,policy,{...owner,Origin:'https://wrong.invalid'})).status,403);
 assert.equal((await f.request('POST',`${base}/ci/runners`,{name:'not-owner'},admin)).status,403);await f.json('PUT',`${base}/protection`,policy,admin);
 const foreign='/api/trunks/other-source-repo';await f.json('POST',foreign,{mode:'git'},owner);const alien=await f.json('POST',`${foreign}/ci/runners`,{name:'shared-pool'},owner);
 assert.equal((await f.request('PUT',`${base}/protection`,{...policy,checkSources:[{name:'test',runner:alien.id}]},owner)).status,400);await f.json('DELETE',`${foreign}/ci/${alien.id}`,undefined,owner);
 const finish=async(runner:any)=>{
  let run=(await f.json('POST',`${base}/ci/claim`,{},auth(runner))).run;
  while(run&&run.head!==head){await f.json('POST',`${base}/ci/runs/${run.id}`,{attempt:run.attempt,results:[],staging:null},auth(runner));run=(await f.json('POST',`${base}/ci/claim`,{},auth(runner))).run;}
  assert.ok(run);const body={attempt:run.attempt,results:[{name:'test',state:'success',command:'git fsck --strict',log:'https://fixture.invalid/checked',artifacts:[]}],staging:null};
  assert.equal((await f.request('POST',`${base}/ci/runs/${run.id}`,{...body,runner:trusted.id},auth(runner))).status,403);
  assert.equal((await f.request('POST',`${base}/ci/runs/${run.id}`,{...body,results:[{...body.results[0],source:trusted.id}]},auth(runner))).status,403);
  await f.json('POST',`${base}/ci/runs/${run.id}`,body,auth(runner));return run;
 };
 const wrong=await finish(other),open={title:'Source-pinned checks',head:'feature'};
 const rejected=await f.request('POST',`${base}/pulls`,open,owner);assert.equal(rejected.status,400);assert.match((await rejected.json()).error,/must be reported by shared-pool/);assert.equal((await f.json('GET',`${base}/pulls`,undefined,owner)).pulls.length,0);
 await f.json('POST',`${base}/ci/retry`,{runId:wrong.id},owner);await finish(trusted);await f.json('POST',`${base}/pulls`,open,owner);
 let view=await f.json('GET',`${base}/pulls/1`,undefined,reader);assert.equal(view.runs.find((run:any)=>run.id===wrong.id).runner,trusted.id);assert.equal(view.ciSources.length,2);assert.ok(view.ciSources.every((s:any)=>Object.keys(s).sort().join(',')==='id,name,revoked'));assert.deepEqual(view.effectivePolicies.main.checkSources,pin);
 // A stale browser or a successful check name cannot bypass a newly changed pin.
 const changed={...policy,checkSources:[{name:'test',runner:other.id}]};await f.json('PUT',`${base}/protection`,changed,admin);const merge={commit:head,anchor};
 const unchanged=async()=>{const v=await f.json('GET',`${base}/pulls/1`,undefined,owner);assert.equal(v.branches.find((b:any)=>b.name==='main').commit,anchor);assert.equal(v.pull.state,'open');};
 assert.equal((await f.request('POST',`${base}/pulls/1/merge`,merge,owner)).status,400);await unchanged();
 await f.json('PUT',`${base}/protection`,policy,owner);await f.json('DELETE',`${base}/ci/${trusted.id}`,undefined,owner);const replacement=await f.json('POST',`${base}/ci/runners`,{name:'shared-pool'},owner);runners.push(replacement);
 assert.equal((await f.request('POST',`${base}/pulls/1/merge`,merge,owner)).status,400);await unchanged();view=await f.json('GET',`${base}/pulls/1`,undefined,owner);assert.ok(view.ciSources.find((s:any)=>s.id===trusted.id).revoked);assert.equal(view.effectivePolicies.main.checkSources[0].runner,trusted.id);
 const fresh={...policy,checkSources:[{name:'test',runner:replacement.id}]};await f.json('PUT',`${base}/protection`,fresh,owner);assert.equal((await f.request('POST',`${base}/pulls/1/merge`,merge,owner)).status,400);await unchanged();await f.json('POST',`${base}/ci/retry`,{runId:wrong.id},owner);await finish(replacement);
 // An overlapping rule has an independent source restriction and cannot be erased.
 await f.json('PUT',`${base}/protection`,{...fresh,branch:'**',beforeOpen:[],checkSources:[{name:'test',runner:other.id}]},owner);assert.equal((await f.request('POST',`${base}/pulls/1/merge`,merge,owner)).status,400);await unchanged();await f.json('DELETE',`${base}/protection`,{branch:'**'},owner);
 await f.json('POST',`${base}/pulls/1/merge`,merge,owner);const clone=join(f.dir,'clone');await transport('clone',remote,clone);assert.equal((await exec('git',['-C',clone,'rev-parse','HEAD'])).stdout.trim(),head);await exec('git',['-C',clone,'fsck','--strict']);
 const audit=await f.json('GET',`${base}/repository/audit`,undefined,owner);assert.ok(JSON.stringify(audit).includes('checkSources'));
 console.log('PASS: real Git source-pinned required checks at PR opening and final merge; owner/admin boundaries, source spoofing and cross-repo rejection, current policy and revocation, same-name replacement, overlapping pins, exact candidate, audit and clone/fsck');
}finally{
 if(owner){for(const runner of runners)await f.json('DELETE',`${base}/ci/${runner.id}`,undefined,owner).catch(()=>{});if(gitToken)await f.json('DELETE',`/api/tokens/${gitToken.id}`,undefined,owner).catch(()=>{});}
 await f.close();
}
