import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const secret='nhd_'+'d'.repeat(64),token='nhc_'+'e'.repeat(64);
function fixture(answers=[]) {
 let clock=0,stored='';const output=[],progress=[],requests=[],calls=[],waits=[];
 return {output,progress,requests,calls,waits,io:{platform:'darwin',cwd:'/fixture',environment:{},write:v=>output.push(v),progress:v=>progress.push(v),now:()=>clock,wait:async ms=>{waits.push(ms);clock+=ms;},
  execute:async(command,args,options)=>{calls.push({command,args,...options});if(args.includes('approve'))stored=options.input;return{code:0,stdout:args.includes('fill')?stored:'',stderr:''};},
  fetcher:async(url,options)=>{
   requests.push({url,options});
   if(url.endsWith('/device'))return Response.json({device_code:secret,user_code:'ABCD-EFGH',verification_uri:'https://nanohub.sh/cli/authorize',verification_uri_complete:'https://nanohub.sh/cli/authorize?code=ABCD-EFGH',expires_in:600,interval:5});
   if(url.endsWith('/token')){const result=answers.shift();if(result instanceof Error)throw result;return Response.json(result??{access_token:token,token_type:'Bearer'},{status:result?.error?400:200});}
   if(url.endsWith('/whoami'))return Response.json({user:{id:'owner',name:'Owner'},credential:{scopes:['read'],expiresAt:86400000}});
   return Response.json({branches:[],revoked:true});
  }}};
}
test('browser login displays only a user code, opens the exact selected host, respects pending/slow-down and saves in the API helper',async()=>{
 const f=fixture([{error:'authorization_pending'},{error:'slow_down',interval:10}]);
 await run(['auth','login','-R','team/project','--json','--scopes','read','--days','1'],f.io);
 expect(f.waits).toEqual([5000,5000,10000]);expect(f.calls[0].command).toBe('open');expect(f.calls[0].args).toEqual(['https://nanohub.sh/cli/authorize?code=ABCD-EFGH']);
 expect(f.progress.join('')).toContain('ABCD-EFGH');expect(f.output.length).toBe(1);expect(JSON.parse(f.output[0]).authenticated).toBe(true);
 expect([...f.output,...f.progress].join('')).not.toContain(secret);expect([...f.output,...f.progress].join('')).not.toContain(token);
 expect(f.calls.some(c=>c.args.some(a=>a.includes(secret)||a.includes(token)))).toBe(false);expect(f.calls.find(c=>c.args.includes('approve')).input).toContain('path=api/cli/team/project');
 for(const request of f.requests.filter(r=>r.url.endsWith('/device')||r.url.endsWith('/token'))){expect(request.options.redirect).toBe('error');expect(request.options.credentials).toBe('omit');expect(request.options.headers.Authorization).toBeUndefined();}
});
test('headless login tolerates a lost token response with backoff and never launches a browser',async()=>{
 const f=fixture([new Error('lost '+secret)]);await run(['auth','login','-R','team/project','--no-browser','--json'],f.io);
 expect(f.waits).toEqual([5000,10000]);expect(f.requests.filter(r=>r.url.endsWith('/token')).length).toBe(2);expect(f.calls.some(c=>c.command==='open')).toBe(false);expect(JSON.parse(f.output[0]).authenticated).toBe(true);
});
test('protection administration is excluded from default login and must be requested explicitly',async()=>{
 const f=fixture();await run(['auth','login','-R','team/project','--no-browser'],f.io);expect(JSON.parse(f.requests[0].options.body).scopes).not.toContain('protections:write');
 const g=fixture();await run(['auth','login','-R','team/project','--scopes','read,protections:write','--no-browser'],g.io);expect(JSON.parse(g.requests[0].options.body).scopes).toEqual(['read','protections:write']);
});
test('denial, invalid grants and expiry stop polling without storing a credential or leaking device data',async()=>{
 for(const error of ['access_denied','invalid_grant','expired_token']){
  const f=fixture([{error}]);await expect(run(['auth','login','-R','team/project','--no-browser'],f.io)).rejects.toThrow(error==='access_denied'?'denied':error==='expired_token'?'expired':'ended');
  expect(f.calls.length).toBe(0);expect(f.requests.filter(r=>r.url.endsWith('/token')).length).toBe(1);
 }
 const f=fixture(Array.from({length:200},()=>({error:'authorization_pending'})));await expect(run(['auth','login','-R','team/project','--no-browser'],f.io)).rejects.toThrow('expired');expect(f.waits.reduce((n,v)=>n+v,0)).toBe(600000);expect(f.calls.length).toBe(0);
});
test('malicious verification redirects are rejected before opening, and failed local setup revokes only the newly issued grant',async()=>{
 const bad=fixture();bad.io.fetcher=async()=>Response.json({device_code:secret,user_code:'ABCD-EFGH',verification_uri:'https://other.invalid/cli/authorize',verification_uri_complete:'https://other.invalid/cli/authorize?code=ABCD-EFGH',expires_in:600,interval:5});
 await expect(run(['auth','login','-R','team/project'],bad.io)).rejects.toThrow('instructions');expect(bad.calls.length).toBe(0);
 const f=fixture();f.io.execute=async(command,args,options)=>{f.calls.push({command,args,...options});return{code:1,stdout:'',stderr:''};};await expect(run(['auth','login','-R','team/project','--no-browser'],f.io)).rejects.toThrow('credential helper');expect(f.requests.at(-1).url).toEndWith('/api/cli/logout');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({repository:'team/project'});expect(f.progress.join('')).toContain('revoked');
});

test('ruleset administration requires an explicit login request and never joins default scopes',async()=>{
 const f=fixture();await run(['auth','login','-R','team/project','--no-browser'],f.io);expect(JSON.parse(f.requests[0].options.body).scopes).not.toContain('rulesets:write');
 const g=fixture();await run(['auth','login','-R','team/project','--scopes','read,rulesets:write','--no-browser'],g.io);expect(JSON.parse(g.requests[0].options.body).scopes).toEqual(['read','rulesets:write']);
});
test('archive administration is excluded from default login and requested separately',async()=>{
 const f=fixture();await run(['auth','login','-R','team/project','--no-browser'],f.io);expect(JSON.parse(f.requests[0].options.body).scopes).not.toContain('repository:archive');
 const g=fixture();await run(['auth','login','-R','team/project','--scopes','read,repository:archive','--no-browser'],g.io);expect(JSON.parse(g.requests[0].options.body).scopes).toEqual(['read','repository:archive']);
});
test('merge settings administration never joins default login scopes and can be requested explicitly',async()=>{
 const f=fixture();await run(['auth','login','-R','team/project','--no-browser'],f.io);expect(JSON.parse(f.requests[0].options.body).scopes).not.toContain('repository:merge');
 const g=fixture();await run(['auth','login','-R','team/project','--scopes','repository:merge','--no-browser'],g.io);expect(JSON.parse(g.requests[0].options.body).scopes).toEqual(['read','repository:merge']);
});
test('collaborator administration is excluded from default login and must be explicitly requested',async()=>{
 const f=fixture();await run(['auth','login','-R','team/project','--no-browser'],f.io);expect(JSON.parse(f.requests[0].options.body).scopes).not.toContain('collaborators:write');
 const g=fixture();await run(['auth','login','-R','team/project','--scopes','collaborators:write','--no-browser'],g.io);expect(JSON.parse(g.requests[0].options.body).scopes).toEqual(['read','collaborators:write']);
});
