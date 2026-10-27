import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {teamFixture} from './team/fixture.ts';
// @ts-ignore: the trusted controller is a native ESM tool.
import {runOnce} from '../../../tools/ci-runner.mjs';
// @ts-ignore: committed-object migration is a native ESM tool.
import {migrate} from '../../../tools/migrate-repository.mjs';
const f=await teamFixture(),exec=promisify(execFile),trunk='default-branch',base=`/api/trunks/${trunk}`,initial='trunk/既定-🚀';
const environment={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',NANOHUB_API_TOKEN:''};
let owner:any,gitToken:any,runner:any,cliToken:any,migrator:any;
try {
 owner=await f.login('owner','101');const admin=await f.login('admin','202'),writer=await f.login('writer','303'),reader=await f.login('reader','404');
 await f.json('POST',base,{mode:'git',defaultBranch:initial},owner);
 for(const [id,cookie,role]of[['admin',admin,'admin'],['writer',writer,'writer'],['reader',reader,'reader']]as const){const invite=await f.json('POST',base+'/collaborators',{userId:'codegraff:'+id,role},owner);await f.json('POST','/api/invitations/accept',{trunk,token:invite.token},cookie);}
 const config=()=>f.json('GET',base+'/default-branch',undefined,owner);
 assert.equal((await config()).defaultBranch,initial);assert.equal((await f.json('GET',base+'/bootstrap',undefined,owner)).repository.empty,true);
 gitToken=await f.json('POST',base+'/git-tokens',{label:'Default branch Git fixture'},owner);const remote=f.origin+'/git/'+trunk+'.git';
 const source=join(f.dir,'source');await mkdir(source);
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{env:environment})).stdout.replace(/\n$/,'');
 const auth={Authorization:'Basic '+btoa('git:'+gitToken.token)},transport=(...args:string[])=>exec('git',['-C',source,...args],{env:{...environment,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:'Authorization: '+auth.Authorization}});
 await git('init','-b',initial);await mkdir(join(source,'.github/workflows'),{recursive:true});await writeFile(join(source,'.github/workflows/test.yml'),'name: Trusted A\non: push\njobs:\n  test:\n    runs-on: nanohub\n    steps:\n      - run: echo TRUSTED_A\n');await writeFile(join(source,'README.md'),'Seed\n');await writeFile(join(source,'asset.bin'),new Uint8Array([0,255,1,2]));await git('add','.');await git('commit','-m','Seed');const a=await git('rev-parse','HEAD');await transport('push',remote,`HEAD:refs/heads/${initial}`);
 assert.equal(await(await fetch(remote+'/HEAD',{headers:auth})).text(),`ref: refs/heads/${initial}\n`);const firstClone=join(f.dir,'first-clone');await transport('clone',remote,firstClone);assert.equal((await exec('git',['-C',firstClone,'symbolic-ref','HEAD'])).stdout.replace(/\n$/,''),'refs/heads/'+initial);
 assert.equal((await f.json('GET',base+'/bootstrap',undefined,owner)).repository.defaultBranch,initial);
 await git('switch','-c','feature');await writeFile(join(source,'README.md'),'Feature on original target\n');await writeFile(join(source,'.github/workflows/test.yml'),'name: Untrusted candidate\non: push\njobs:\n  test:\n    runs-on: nanohub\n    steps:\n      - run: echo CANDIDATE_MUST_NOT_DEFINE_TRUSTED_CHECKS\n');await git('add','.');await git('commit','-m','Feature');const candidate=await git('rev-parse','HEAD');await transport('push',remote,'feature');
 await f.json('POST',base+'/pulls',{title:'Preserve original target',head:'feature'},owner);let view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.pull.base,initial);
 await f.json('POST',base+'/pulls/1/reviews',{commit:candidate,anchor:view.pull.anchor,verdict:'APPROVE',body:'Review applies to original target'},admin);
 await git('switch',initial);await git('switch','-c','develop');await writeFile(join(source,'README.md'),'Different default\n');await writeFile(join(source,'.github/workflows/test.yml'),'name: Trusted B\non: push\njobs:\n  test:\n    runs-on: nanohub\n    steps:\n      - run: echo TRUSTED_B\n');await git('add','.');await git('commit','-m','New default');const b=await git('rev-parse','HEAD');await transport('push',remote,'develop');
 const observed=await config(),beforeRefs=(await f.json('GET',base+'/repository',undefined,owner)).refs;
 for(const cookie of [writer,reader])assert.equal((await f.request('PUT',base+'/default-branch',{branch:'develop',commit:b,revision:observed.revision},cookie)).status,403);
 assert.equal((await f.request('PUT',base+'/default-branch',{branch:'develop',commit:b,revision:observed.revision},{...owner,Origin:'https://wrong.invalid'})).status,403);
 assert.equal((await f.request('PUT',base+'/default-branch',{branch:'develop',commit:a,revision:observed.revision},owner)).status,400);
 const rule=await f.json('POST',base+'/rulesets',{name:'Follow default',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'update'}]},owner);
 runner=await f.json('POST',base+'/ci/runners',{name:'default-context-runner'},owner);await f.json('POST',base+'/environments',{name:'gate',runner:runner.id},owner);
 await f.json('PUT',base+'/protection',{branch:initial,pullRequest:true,approvals:1,checks:['test'],beforeOpen:[],checkSources:[{name:'test',runner:runner.id}],preventForce:true,preventDelete:true,environments:['gate']},owner);
 const selected=await f.json('PUT',base+'/default-branch',{branch:'develop',commit:b,revision:observed.revision},admin);assert.equal(selected.defaultBranch,'develop');assert.equal((await config()).revision,observed.revision+1);assert.deepEqual((await f.json('GET',base+'/repository',undefined,owner)).refs,beforeRefs);
 await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'writer'},owner);assert.equal((await f.request('PUT',base+'/default-branch',{branch:initial,commit:a,revision:selected.revision},admin)).status,403);await f.json('PATCH',base+'/collaborators',{userId:'codegraff:admin',role:'admin'},owner);
 assert.equal((await f.request('PUT',base+'/default-branch',{branch:initial,commit:a,revision:observed.revision},owner)).status,409);assert.equal((await config()).defaultBranch,'develop');
 view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.pull.base,initial);assert.equal(view.ciBase,b);assert.equal(view.reviewGate.approvals,1);
 assert.equal(await(await fetch(remote+'/HEAD',{headers:auth})).text(),'ref: refs/heads/develop\n');
 await assert.rejects(transport('push','--force',remote,'feature:refs/heads/develop'),/updates are restricted/);
 assert.equal((await f.request('DELETE',base+'/branches',{name:'develop',commit:b},owner)).status,400);
 await f.json('POST',base+'/branches',{name:'from-default'},owner);assert.equal((await f.json('GET',base+'/branches/tree?name=from-default',undefined,reader)).branch.commit,b);
 // The controller reads its own trusted adapter outside candidate code. The
 // candidate and workflow commits intentionally are sibling histories.
 const adapter=join(f.dir,'trusted-adapter.mjs');await writeFile(adapter,`import assert from 'node:assert/strict';import{execFile}from'node:child_process';import{promisify}from'node:util';const exec=promisify(execFile);export async function execute(c){const git=async(...a)=>(await exec('git',['-C',c.source,...a])).stdout.trim();assert.equal(await git('rev-parse','HEAD'),c.run.head);assert.match(await git('show',c.run.base+':.github/workflows/test.yml'),/TRUSTED_B/);return{results:[{name:'test',state:'success',command:'Synthetic trusted adapter at '+c.run.base,log:'',artifacts:[]}],staging:null,deployments:c.deploymentAuthorization?[{environment:'gate',head:c.run.head,base:c.run.base,state:'success',deploymentId:'synthetic-default-proof',url:'https://evidence.invalid/default',verifiedAt:Date.now(),authorizationId:c.deploymentAuthorization.id}]:[]};}`);
 const controller={origin:f.origin,trunk,backend:'docker',pipelineAdapter:adapter,stagingEnvironment:'gate',artifacts:join(f.dir,'artifacts'),artifactOrigin:'https://evidence.invalid/logs/'};
 for(let i=0;i<20;i++){const result=await runOnce(controller,runner.token);if(result.idle)break;if(i===19)throw Error('Queue did not drain');}
 view=await f.json('GET',base+'/pulls/1',undefined,owner);let response=await f.request('POST',base+'/pulls/1/merge',{commit:candidate,anchor:view.pull.anchor},owner);assert.equal(response.status,400);assert.match((await response.json()as any).error,/deployment/i);
 const run=view.runs.find((r:any)=>r.branch==='feature'&&r.head===candidate&&r.base===b&&r.state==='complete');assert.ok(run);await f.json('POST',base+'/ci/approve',{runId:run.id},owner);await runOnce(controller,runner.token);
 view=await f.json('GET',base+'/pulls/1',undefined,owner);assert.equal(view.deployments.ready,true);assert.equal(view.reviewGate.approvals,1);const merged=await f.json('POST',base+'/pulls/1/merge',{commit:candidate,anchor:view.pull.anchor},owner);assert.equal(merged.pulls[0].mergedCommit,candidate);assert.equal(merged.pulls[0].mergedCIBase,b);assert.equal(merged.pulls[0].mergedVersion,null);
 const refs=(await f.json('GET',base+'/repository',undefined,owner)).refs;assert.equal(refs.find((r:any)=>r.name===`refs/heads/${initial}`).commit,candidate);assert.equal(refs.find((r:any)=>r.name==='refs/heads/develop').commit,b);
 cliToken=await f.json('POST',base+'/cli-credentials',{label:'Default CLI fixture',scopes:['read','pulls:write'],days:1},owner);const cliBin=resolve(import.meta.dirname,'../../cli/bin/nh.mjs');
 await f.json('POST',base+'/branches',{name:'cli-feature'},owner);await git('switch','develop');await git('switch','-c','cli-feature');await writeFile(join(source,'cli.txt'),'Native CLI default\n');await git('add','.');await git('commit','-m','CLI feature');await transport('push',remote,'cli-feature');
 const cli=await exec('bun',[cliBin,'pr','create','--title','Use configured default','--head','cli-feature','--trunk',trunk,'--host',f.origin,'--json'],{cwd:f.dir,env:{...environment,NANOHUB_API_TOKEN:cliToken.token}});assert.equal(JSON.parse(cli.stdout).pull.base,'develop');
 assert.equal((await f.request('PUT','/api/cli/trunks/'+trunk+'/default-branch',{branch:initial,commit:candidate,revision:selected.revision},{Authorization:'Bearer '+cliToken.token})).status,403);
 await f.json('POST',base+'/pulls/2/close',{},owner);await f.json('POST',base+'/pulls',{title:'Requires target ancestry',head:'cli-feature',base:initial},owner);const divergent=await f.json('GET',base+'/pulls/3',undefined,owner);const deniedMerge=await f.request('POST',base+'/pulls/3/merge',{commit:divergent.head.commit,anchor:divergent.pull.anchor},owner);assert.equal(deniedMerge.status,400);assert.match((await deniedMerge.json()as any).error,/Target branch moved/);
 const latest=await config();await f.json('POST',base+'/archive',{archived:true,revision:0,confirmation:trunk},owner);assert.equal((await f.request('PUT',base+'/default-branch',{branch:initial,commit:candidate,revision:latest.revision},owner)).status,403);await f.json('POST',base+'/archive',{archived:false,revision:1,confirmation:trunk},owner);
 await f.json('DELETE',base+'/rulesets/'+rule.id,undefined,owner);
 const clone=join(f.dir,'clone');await transport('clone',remote,clone);assert.equal((await exec('git',['-C',clone,'symbolic-ref','HEAD'])).stdout.trim(),'refs/heads/develop');await exec('git',['-C',clone,'fsck','--strict']);
 const activity=await f.json('GET',base+'/repository/audit?kind=settings',undefined,admin);assert.equal(activity.events.length,1);assert.equal(activity.events[0].defaultBranch.previous,initial);assert.equal(activity.events[0].defaultBranch.next,'develop');
 // A main-less source migrates without adding/renaming a branch. The selected
 // destination default must already name a committed source ref.
 await f.json('POST','/api/trunks/default-migration',{mode:'git',defaultBranch:initial},owner);await f.json('POST','/api/trunks/default-migration/agents',{handle:'migrator',type:'external'},owner);migrator=await f.json('POST','/api/trunks/default-migration/agents/migrator/token',{},owner);
 assert.equal((await f.request('PUT','/api/trunks/default-migration/default-branch',{branch:initial,commit:a,revision:0},{Authorization:'Basic '+btoa('migrator:'+migrator.token)})).status,403);
 await f.json('POST','/api/namespaces',{name:'default-owner'},owner);const addressed=await f.json('POST','/api/repos/default-owner/custom',{defaultBranch:initial},owner);assert.equal((await f.json('GET',`/api/trunks/${addressed.id}/default-branch`,undefined,owner)).defaultBranch,initial);assert.equal((await f.request('POST','/api/repos/default-owner/invalid',{defaultBranch:'bad..name'},owner)).status,400);assert.equal((await f.request('GET','/api/repos/default-owner/invalid',undefined,owner)).status,404);
 const migration=await migrate(source,f.origin+'/git/default-migration.git','migrator',migrator.token);assert.equal(migration.verified,true);assert.ok(!(await f.json('GET','/api/trunks/default-migration/repository',undefined,owner)).refs.some((r:any)=>r.name==='refs/heads/main'));
 await f.restart();assert.equal((await config()).defaultBranch,'develop');assert.equal(await(await fetch(f.origin+'/git/'+trunk+'.git/HEAD',{headers:auth})).text(),'ref: refs/heads/develop\n');
 console.log('PASS: Unicode/main-less default creation and migration, real clone symbolic HEAD, unchanged refs, current admin/CAS/origin/archive guards, moving default rules, exact old-target protection/review/CI/deployment gates, trusted controller on sibling candidate, native CLI default, audit and restart');
} finally {
 if(owner&&gitToken)await f.request('DELETE','/api/tokens/'+gitToken.id,undefined,owner).catch(()=>{});
 if(owner&&cliToken)await f.request('DELETE','/api/cli/credentials/'+cliToken.id,undefined,owner).catch(()=>{});
 if(owner&&runner)await f.request('DELETE',base+'/ci/'+runner.id,undefined,owner).catch(()=>{});
 if(owner&&migrator)await f.request('DELETE','/api/trunks/default-migration/agents/migrator/token',undefined,owner).catch(()=>{});
 await f.close();
}
