import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const token='nhc_'+'f'.repeat(64),sha='a'.repeat(40),revision='b'.repeat(64),from="feature/日本語/'-$USER;$(literal)",to='renamed/'+"日本語/'-$USER;$(literal)";
function fixture(){
 const requests=[],output=[],data={protocol:1,mode:'git',defaultBranch:'main',revision,conditionalWrites:true,revisionTracking:'storage',cliAudit:true,branches:[{name:from,commit:sha}],readOnly:false,canRename:true,canRenameProtected:true,preview:{from,to,commit:sha,revision,requiresAdmin:false}};
 return {requests,output,data,io:{cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),execute:async()=>{throw Error('Branch commands must not run Git, a shell or a browser');},fetcher:async(url,options)=>{requests.push({url,options});return Response.json(options.method==='POST'?{...data,revision:'c'.repeat(64),renamed:{from,to,commit:sha}}:data);}}};
}
test('native branch list and rename preserve literal names and issue one conditional write with the observed exact head',async()=>{
 const f=fixture();await run(['branch','list','-R','team/project','--json'],f.io);expect(JSON.parse(f.output.at(-1)).revision).toBe(revision);
 await run(['branch','rename',from,to,'--revision',revision,'-R','team/project','--json'],f.io);
 expect(f.requests.length).toBe(3);const first=new URL(f.requests[1].url);expect(first.searchParams.get('from')).toBe(from);expect(first.searchParams.get('to')).toBe(to);
 const write=f.requests.at(-1);expect(write.url).toBe('https://nanohub.sh/api/cli/repos/team/project/branch-rename');expect(write.options.method).toBe('POST');expect(write.options.headers['If-Match']).toBe('"branch-rename-'+revision+'"');expect(JSON.parse(write.options.body)).toEqual({from,to,commit:sha,revision});
 expect(JSON.parse(f.output.at(-1)).renamed).toEqual({from,to,commit:sha});
 for(const request of f.requests){expect(request.options.credentials).toBe('omit');expect(request.options.redirect).toBe('error');}expect(f.output.join('')).not.toContain(token);
});
test('misplaced options and incomplete, stale, archived or unauthorized previews stop before a rename',async()=>{
 for(const args of [['list','extra'],['list','--revision',revision],['rename',from],['rename',from,from],['rename',from,to,'--web'],['rename',from,to,'--file','other'],['rename',from,to,'--revision','1'],['rename',from,to,'--head','spoof']]){
  const f=fixture();await expect(run(['branch',...args,'-R','team/project'],f.io)).rejects.toThrow();expect(f.requests.length).toBe(0);
 }
 for(const patch of [{protocol:undefined},{revisionTracking:'legacy'},{readOnly:true},{canRename:false},{mode:'snapshot'},{preview:null},{preview:{from,to,commit:sha,revision,requiresAdmin:true},canRenameProtected:false}]){
  const f=fixture();Object.assign(f.data,patch);await expect(run(['branch','rename',from,to,'-R','team/project'],f.io)).rejects.toThrow();expect(f.requests.length).toBe(1);expect(f.requests[0].options.method).toBe('GET');
 }
 const f=fixture();await expect(run(['branch','rename',from,to,'--revision','d'.repeat(64),'-R','team/project'],f.io)).rejects.toThrow('settings changed');expect(f.requests.length).toBe(1);
});
test('a lost rename answer, precondition rejection or mismatched result never retries a mutation or prints success',async()=>{
 for(const kind of ['lost','stale','mismatch']){
  const f=fixture(),get=f.io.fetcher;f.io.fetcher=async(url,options)=>{if(options.method==='GET')return get(url,options);f.requests.push({url,options});if(kind==='lost')throw Error(token);return kind==='stale'?Response.json({error:'Branches changed'},{status:412}):Response.json({...f.data,renamed:{from,to:'another',commit:sha}});};
  await expect(run(['branch','rename',from,to,'-R','team/project'],f.io)).rejects.toThrow(kind==='lost'?'Inspect branch list':kind==='stale'?'Branches changed':'not confirmed');expect(f.requests.length).toBe(2);expect(f.output.length).toBe(0);
 }
});
