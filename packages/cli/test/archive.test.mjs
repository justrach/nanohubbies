import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const token='nhc_'+'f'.repeat(64);
function fixture(){
 const requests=[],output=[];let archived=false,revision=3;
 return {requests,output,io:{cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),execute:async()=>{throw Error('No browser or Git process should run');},fetcher:async(url,options)=>{
  requests.push({url,options});if(options.method==='POST'){const body=JSON.parse(options.body);archived=body.archived;revision++;}
  return Response.json({archived,revision,transition:null,confirmation:'project',canManage:true,conditionalWrites:true});
 }}};
}
test('archive status and lifecycle writes use the native exact-repository API with explicit revisions and names',async()=>{
 const f=fixture();await run(['repo','archive-status','-R','team/project','--json'],f.io);expect(JSON.parse(f.output.at(-1)).revision).toBe(3);expect(f.requests[0].url).toBe('https://nanohub.sh/api/cli/repos/team/project/archive');
 await run(['repo','archive','--revision','3','--confirm','project','-R','team/project','--json'],f.io);
 expect(f.requests.at(-1).options.headers['If-Match']).toBe('"archive-3"');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({archived:true,revision:3,confirmation:'project'});expect(JSON.parse(f.output.at(-1)).archived).toBe(true);
 await run(['repo','unarchive','--revision','4','--confirm','project','-R','team/project'],f.io);expect(f.output.at(-1)).toBe('Unarchived project. Revision: 5.');
 for(const request of f.requests){expect(request.options.headers.Authorization).toBe('Bearer '+token);expect(request.options.credentials).toBe('omit');expect(request.options.redirect).toBe('error');}expect(f.output.join('')).not.toContain(token);
});
test('archive commands reject missing confirmation, unsafe revisions, extra arguments and browser flags before requesting',async()=>{
 const f=fixture();for(const args of [['archive'],['unarchive','--revision','0'],['archive','--revision','9007199254740992','--confirm','project'],['archive','--revision','-1','--confirm','project'],['archive','extra','--revision','0','--confirm','project'],['archive','--web'],['archive-status','--revision','0'],['archive-status','--file','input']])await expect(run(['repo',...args,'-R','team/project'],f.io)).rejects.toThrow();expect(f.requests.length).toBe(0);
});
test('lost archive answers and stale edits never retry or report completion; pending state is visible',async()=>{
 const f=fixture();f.io.fetcher=async(url,options)=>{f.requests.push({url,options});throw Error('Lost '+token);};
 await expect(run(['repo','archive','--revision','3','--confirm','project','-R','team/project'],f.io)).rejects.toThrow('Inspect repo archive-status');expect(f.requests.length).toBe(1);expect(f.output.length).toBe(0);
 f.io.fetcher=async()=>Response.json({error:'Archive state changed; refresh before continuing'},{status:412});await expect(run(['repo','unarchive','--revision','3','--confirm','project','-R','team/project'],f.io)).rejects.toThrow('state changed');
 f.io.fetcher=async()=>Response.json({archived:true,revision:3,confirmation:'project',transition:{archived:false}});await run(['repo','archive-status','-R','team/project'],f.io);expect(f.output.at(-1)).toContain('Reopening');
 await expect(run(['repo','archive','--revision','3','--confirm','project','-R','team/project'],f.io)).rejects.toThrow('not complete');
});
