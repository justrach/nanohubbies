import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const token='nhc_'+'f'.repeat(64),sha='a'.repeat(40),branch="trunk/日本語/'-$USER;$(literal)";
function fixture(){
 const requests=[],output=[];
 const data={mode:'git',defaultBranch:'main',revision:3,branches:[{name:'main',commit:'b'.repeat(40)},{name:branch,commit:sha}],readOnly:false,canManage:true,conditionalWrites:true,cliAudit:true,revisionTracking:'storage'};
 return {requests,output,data,io:{cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),execute:async()=>{throw Error('No Git or browser process should run');},fetcher:async(url,options)=>{requests.push({url,options});return Response.json(options.method==='PUT'?{defaultBranch:JSON.parse(options.body).branch,revision:4}:data);}}};
}
test('repo default-branch and repo edit retain literal names and bind a single conditional write to the observed head/revision',async()=>{
 const f=fixture();await run(['repo','default-branch','-R','team/project','--json'],f.io);expect(JSON.parse(f.output.at(-1)).revision).toBe(3);
 await run(['repo','edit','--default-branch',branch,'-R','team/project','--json'],f.io);expect(f.requests.length).toBe(3);
 const {url,options}=f.requests.at(-1);expect(url).toBe('https://nanohub.sh/api/cli/repos/team/project/default-branch');expect(options.method).toBe('PUT');expect(options.headers['If-Match']).toBe('"default-3"');expect(JSON.parse(options.body)).toEqual({branch,commit:sha,revision:3});expect(JSON.parse(f.output.at(-1)).defaultBranch).toBe(branch);
 for(const request of f.requests){expect(request.options.headers.Authorization).toBe('Bearer '+token);expect(request.options.credentials).toBe('omit');expect(request.options.redirect).toBe('error');}expect(f.output.join('')).not.toContain(token);
});
test('invalid edit options, unavailable heads, legacy receivers, stale revisions, archive and missing permissions never write',async()=>{
 for(const args of [['edit'],['edit','--default-branch','main','extra'],['default-branch','--revision','1'],['edit','--default-branch','main','--web'],['view','--default-branch','main'],['edit','--default-branch','main','--revision','-1']]){
  const f=fixture();await expect(run(['repo',...args,'-R','team/project'],f.io)).rejects.toThrow();expect(f.requests.length).toBe(0);
 }
 for(const [patch,value,revision]of [[{},'missing'],[{},branch,'2'],[{revisionTracking:'legacy'},branch],[{canManage:false},branch],[{readOnly:true},branch],[{mode:'snapshot'},branch],[{revision:Number.MAX_SAFE_INTEGER+1},branch]]){
  const f=fixture();Object.assign(f.data,patch);await expect(run(['repo','edit','--default-branch',value,...(revision?['--revision',revision]:[]),'-R','team/project'],f.io)).rejects.toThrow();expect(f.requests.length).toBe(1);expect(f.requests[0].options.method).toBe('GET');
 }
});
test('lost answers and server precondition failures never retry or report a default branch edit as successful',async()=>{
 for(const response of ['lost','stale','wrong']){
  const f=fixture(),get=f.io.fetcher;f.io.fetcher=async(url,options)=>{if(options.method==='GET')return get(url,options);f.requests.push({url,options});if(response==='lost')throw Error(token);return response==='stale'?Response.json({error:'Settings changed'},{status:412}):Response.json({defaultBranch:'wrong',revision:4});};
  await expect(run(['repo','edit','--default-branch',branch,'--revision','3','-R','team/project'],f.io)).rejects.toThrow(response==='lost'?'Inspect repo default-branch':response==='stale'?'Settings changed':'not confirmed');expect(f.requests.length).toBe(2);expect(f.output.length).toBe(0);
 }
});
