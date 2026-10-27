/** Explicit opt-in only: allocates a real billable Codegraff fleet VM. Uses an
 * isolated local Nanohub Worker/repo, never a production repository credential.
 * Supply the existing CI account key in the environment; no key is persisted. */
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {teamFixture} from './team/fixture.ts';
import {runOnce} from '../../../tools/ci-runner.mjs';
import {Codegraff} from '../../../tools/codegraff-actions.mjs';
if(process.env.NANOHUB_LIVE_CODEGRAFF!=='1'||!process.env.CODEGRAFF_API_KEY)throw Error('Explicit NANOHUB_LIVE_CODEGRAFF=1 and a sandbox-scoped CODEGRAFF_API_KEY are required');
const artifacts=process.argv[2];if(!artifacts||!isAbsolute(artifacts))throw Error('Provide an absolute private receipt/artifact directory');
await mkdir(artifacts,{recursive:true,mode:0o700});
const f=await teamFixture(),exec=promisify(execFile),trunk='live-codegraff-smoke',base='/api/trunks/'+trunk,client=new Codegraff(process.env.CODEGRAFF_API_KEY);
const image='oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d';
let owner:any,gitKey:any,runner:any;
try{
 owner=await f.login('live-smoke-owner','101');await f.json('POST',base,{mode:'git'},owner);
 gitKey=await f.json('POST',base+'/git-tokens',{label:'Local live-cloud fixture'},owner);runner=await f.json('POST',base+'/ci/runners',{name:'live-codegraff'},owner);
 const source=join(f.dir,'source');await mkdir(join(source,'.github/workflows'),{recursive:true});
 const workflow='name: Live cloud\non: push\njobs:\n  bun:\n    runs-on: codegraff\n    timeout-minutes: 5\n    steps:\n      - run: test "$(bun --version)" = "1.4.4"\n      - run: bun test\n';
 await writeFile(join(source,'.github/workflows/live.yml'),workflow);await writeFile(join(source,'README.md'),'Trusted base\n');await writeFile(join(source,'package.json'),JSON.stringify({name:'nanohub-live-fixture',private:true,packageManager:'bun@1.4.4'}));
 await writeFile(join(source,'smoke.test.ts'),`import {test,expect} from 'bun:test';
test('real Bun runner checks the exact candidate without control credentials',async()=>{
 expect(Bun.version).toBe('1.4.4');expect(await Bun.file('README.md').text()).toBe('Actual candidate\\n');
 expect(process.env.GITHUB_SHA).toMatch(/^[a-f0-9]{40}$/);expect(process.env.GITHUB_REF).toBe('refs/heads/candidate');
 for(const name of ['CODEGRAFF_API_KEY','NANOHUB_CI_TOKEN','NANOHUB_TOKEN','GITHUB_TOKEN'])expect(Boolean(process.env[name])).toBe(false);
 console.log('NANOHUB_LIVE_CLOUD_OK');
});
`);
 const git=async(...args:string[])=>(await exec('git',['-C',source,'-c','user.name=Live fixture','-c','user.email=fixture@example.invalid',...args],{env:{PATH:process.env.PATH,HOME:f.dir,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'}})).stdout.trim();
 const remote=f.origin+'/git/'+trunk+'.git',push=async(branch:string)=>exec('git',['-C',source,'push',remote,branch],{env:{PATH:process.env.PATH,HOME:f.dir,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:'Authorization: Basic '+btoa('git:'+gitKey.token)}});
 await git('init','-b','main');await git('add','.');await git('commit','-m','Trusted workflow');const baseCommit=await git('rev-parse','HEAD');await push('main');
 // The seed push is queued too. End that fixture-only event explicitly before
 // pushing the candidate; it is not recorded as a successful cloud check.
 const seed=await f.json('POST',base+'/ci/claim',{}, {authorization:'Bearer '+runner.token});
 assert.equal(seed.run.head,baseCommit);
 await f.json('POST',base+'/ci/runs/'+seed.run.id,{attempt:seed.run.attempt,results:[],staging:null},{authorization:'Bearer '+runner.token});
 await git('checkout','-b','candidate');await writeFile(join(source,'README.md'),'Actual candidate\n');await writeFile(join(source,'.github/workflows/live.yml'),workflow.replace('bun test','echo UNTRUSTED_WORKFLOW_MUST_NOT_RUN; exit 9'));await git('commit','-am','Synthetic candidate');const head=await git('rev-parse','HEAD');await push('candidate');
 console.log('Running the actual dispatcher with a real disposable Codegraff VM');
 const completed=await runOnce({origin:f.origin,trunk,backend:'codegraff',image,network:'none',prepare:'',artifacts},runner.token);
 await writeFile(join(artifacts,'local-completion.json'),JSON.stringify(completed,null,2)+'\n',{mode:0o600});
 assert.equal(completed.head,head);assert.equal(completed.base,baseCommit);assert.equal(completed.results.length,1);const result=completed.results[0];
 assert.equal(result.name,'live/bun');assert.equal(result.state,'success');assert.equal(result.execution.provider,'codegraff');
 const sandbox=result.execution.sandboxId;assert.match(sandbox,/^[A-Za-z0-9_-]{1,160}$/);
 let deleted=false;try{const current=await client.api('/sandboxes/'+sandbox);deleted=['destroyed','deleted','expired'].includes(current.state);}catch(error){deleted=(error as {status?:number}).status===404;}assert.ok(deleted,'The allocated sandbox must be destroyed or absent');
 const logPath=new URL(result.log).pathname,log=await f.request('GET',logPath,undefined,owner);assert.equal(log.status,200);const text=await log.text();assert.ok(text.includes('NANOHUB_LIVE_CLOUD_OK'));assert.ok(!text.includes('UNTRUSTED_WORKFLOW_MUST_NOT_RUN'));
 assert.equal((await f.request('GET',logPath)).status,404);assert.ok(!text.includes(process.env.CODEGRAFF_API_KEY!));assert.ok(!text.includes(runner.token));assert.ok(!text.includes(gitKey.token));
 const receipt=JSON.parse(await readFile(join(artifacts,completed.id,String(completed.attempt),'live-bun.sandbox.json'),'utf8'));assert.equal(receipt.cleanupNeeded,false);
 await writeFile(join(artifacts,'receipt.json'),JSON.stringify({checkedAt:new Date().toISOString(),localNanohub:true,productionCodegraff:true,head,base:baseCommit,image,sandboxId:sandbox,check:result.name,conclusion:result.state,cleanupDeleted:true,privateLogDelivered:true,anonymousLogDenied:true,acceptedBaseWorkflow:true,credentialFreeCandidate:true},null,2)+'\n',{mode:0o600});
 console.log('PASS: real Codegraff VM, pinned Bun 1.4.4, exact candidate/trusted workflow, private Nanohub log and callback, no candidate control credentials and confirmed sandbox deletion');
}finally{if(owner){if(runner)await f.request('DELETE',base+'/ci/'+runner.id,undefined,owner).catch(()=>{});if(gitKey)await f.request('DELETE','/api/tokens/'+gitKey.id,undefined,owner).catch(()=>{});}await f.close();}
