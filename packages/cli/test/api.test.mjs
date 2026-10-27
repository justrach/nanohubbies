import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
import {apiRequest} from '../src/api.mjs';
const token='nhc_'+'b'.repeat(64);
function fixture() {
 const calls=[],requests=[],output=[];let stored='';
 const view={pull:{number:1,title:'Change',state:'open',head:'feature',base:'main',anchor:'a'.repeat(40),body:'Review me'},head:{commit:'b'.repeat(40)},files:[{path:'README.md',patch:'@@ -1 +1 @@\n-Old\n+New'}],truncated:[],reviewGate:{ready:false,error:'Requires independent approval'}};
 return {calls,requests,output,view,io:{platform:'darwin',cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:v=>output.push(v),readToken:async()=>token,
  execute:async(command,args,options)=>{calls.push({command,args,...options});if(args.includes('approve'))stored=options.input;return{code:0,stdout:args.includes('fill')?stored:'',stderr:''};},
  fetcher:async(url,options)=>{requests.push({url,options});const body=options.body?JSON.parse(options.body):undefined;
   if(url.endsWith('/whoami'))return Response.json({user:{id:'writer',name:'Writer'},credential:{scopes:['read','reviews:write'],expiresAt:Date.now()+10000}});
   if(url.endsWith('/logout'))return Response.json({revoked:true});
   if(url.endsWith('/reviews'))return Response.json({reviews:[{...body,id:1,author:{id:'writer'}}]});
   if(url.endsWith('/comments'))return Response.json({comments:[body]});
   if(url.endsWith('/merge')||url.endsWith('/close'))return Response.json({pulls:[{...view.pull,state:url.endsWith('/merge')?'merged':'closed'}]});
   if(url.endsWith('/pulls/1'))return Response.json(view);
   return Response.json({pulls:[view.pull],branches:[],runs:[]});
  }}};
}
test('native PR commands carry only the CLI bearer on an exact selected host, never a browser cookie or token URL',async()=>{
 const f=fixture();await run(['pr','view','1','-R','team/project','--json'],f.io);
 expect(JSON.parse(f.output[0]).pull.number).toBe(1);expect(f.calls.length).toBe(0);
 expect(f.requests[0].url).toBe('https://nanohub.sh/api/cli/repos/team/project/pulls/1');
 expect(f.requests[0].options.headers.Authorization).toBe('Bearer '+token);expect(f.requests[0].options.credentials).toBe('omit');expect(f.requests[0].options.redirect).toBe('error');expect(f.output.join('')).not.toContain(token);
 await run(['pr','diff','1','-R','team/project'],f.io);expect(f.output.at(-1)).toContain('+New');expect(f.output.at(-1)).not.toContain('truncated');
});
test('review, bounded inline selection and merge bind the current exact head and comparison',async()=>{
 const f=fixture();await run(['pr','review','1','-R','team/project','--verdict','approve','--body','Reviewed','--json'],f.io);
 let body=JSON.parse(f.requests.at(-1).options.body);expect(body.commit).toBe(f.view.head.commit);expect(body.anchor).toBe(f.view.pull.anchor);expect(body.verdict).toBe('APPROVE');expect(body.author).toBeUndefined();
 await run(['pr','comment','1','-R','team/project','--path','README.md','--start-line','1','--line','2','--body','Check this'],f.io);
 body=JSON.parse(f.requests.at(-1).options.body);expect(body.side).toBe('RIGHT');expect(body.startLine).toBe(1);expect(body.line).toBe(2);expect(body.commit).toBe(f.view.head.commit);
 await expect(run(['pr','comment','1','-R','team/project','--path','README.md','--start-line','1','--line','202','--body','Too much'],f.io)).rejects.toThrow('within one hunk');
 await run(['pr','merge','1','-R','team/project','--json'],f.io);expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({commit:f.view.head.commit,anchor:f.view.pull.anchor});expect(JSON.parse(f.output.at(-1)).pull.state).toBe('merged');
});
test('API login verifies repository scope before storing in a separate helper path; logout revokes before local removal',async()=>{
 const f=fixture();f.io.environment={};await run(['auth','login','--with-api-token','-R','team/project','--json'],f.io);
 expect(f.calls[0].input).toContain('path=api/cli/team/project\nusername=nanohub-cli\npassword='+token);expect(f.output.join('')).not.toContain(token);
 expect(f.requests.map(r=>r.url)).toEqual(['https://nanohub.sh/api/cli/whoami','https://nanohub.sh/api/cli/repos/team/project/branches']);
 await run(['auth','logout','--api','-R','team/project','--json'],f.io);expect(f.requests.at(-1).url).toEndWith('/api/cli/logout');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({repository:'team/project'});expect(f.calls.at(-1).args.at(-1)).toBe('reject');expect(JSON.parse(f.output.at(-1)).revoked).toBe(true);
 const bad=fixture();bad.io.fetcher=async()=>Response.json({error:'Wrong repository'},{status:404});await expect(run(['auth','login','--with-api-token','-R','other/repo'],bad.io)).rejects.toThrow('Wrong repository');expect(bad.calls.length).toBe(0);
});
test('transport and error handling reject Git tokens, redirects, cross-host URLs and unsafe automatic mutation retries',async()=>{
 await expect(apiRequest('https://nanohub.sh','/api/cli/whoami','nhg_'+'c'.repeat(48))).rejects.toThrow('nhc_');
 await expect(apiRequest('https://nanohub.sh','https://other.invalid/api/cli/whoami',token)).rejects.toThrow('selected host');
 await expect(apiRequest('https://nanohub.sh','/api/cli/whoami',token,{fetcher:async()=>{throw Error('network '+token);}})).rejects.toThrow('network access');
 let calls=0;await expect(apiRequest('https://nanohub.sh','/api/cli/trunks/id/pulls',token,{method:'POST',body:{},fetcher:async()=>{calls++;throw Error('lost');}})).rejects.toThrow('Inspect the pull request');expect(calls).toBe(1);
 await expect(apiRequest('https://nanohub.sh','/api/cli/whoami',token,{fetcher:async()=>Response.json({error:'secret '+token},{status:403})})).rejects.toThrow('secret [redacted]');
});
test('Actions text output uses native run state and distinguishes same-named branch and tag runs',async()=>{
 const f=fixture(),head='a'.repeat(40),runs=[{id:'branch-run',state:'running',branch:'release/v1',head},{id:'tag-run',state:'waiting',branch:'release/v1',ref:'refs/tags/release/v1',head}];f.io.fetcher=async()=>Response.json({runs});
 await run(['run','list','-R','team/project'],f.io);expect(f.output[0]).toBe(`branch-run\trunning\trefs/heads/release/v1\t${head}\ntag-run\twaiting\trefs/tags/release/v1\t${head}`);expect(f.output[0]).not.toContain('undefined');
 await run(['run','list','-R','team/project','--json'],f.io);expect(JSON.parse(f.output.at(-1))).toEqual({runs});
});
test('Actions terminal conclusions are visible in text and stay lossless in JSON',async()=>{
 const f=fixture(),head='b'.repeat(40),states=['success','neutral','skipped','failure','cancelled','timed_out','action_required','stale'],runs=states.map(state=>({id:state+'-run',state:'complete',branch:'feature',head,results:[{name:'test',state}]}));f.io.fetcher=async()=>Response.json({runs});
 await run(['run','list','-R','team/project'],f.io);for(const state of states)expect(f.output.at(-1)).toContain(`${state}-run\tcomplete / ${state}\trefs/heads/feature\t${head}`);
 await run(['run','list','-R','team/project','--json'],f.io);expect(JSON.parse(f.output.at(-1))).toEqual({runs});
});
test('flag=value preserves literal ref punctuation and leading dashes without changing other option boundaries',async()=>{
 const f=fixture();f.io.fetcher=async(url,options)=>{f.requests.push({url,options});const body=JSON.parse(options.body);return Response.json({pulls:[{...f.view.pull,head:body.head,title:body.title}]});};
 for(const head of ['-leading','日本語/修正',`literal/$USER;'"=value`]){await run(['pr','create','--title=Literal ref','--head='+head,'--body=','-R','team/project','--json'],f.io);const body=JSON.parse(f.requests.at(-1).options.body);expect(body.head).toBe(head);expect(body.body).toBe('');expect(JSON.parse(f.output.at(-1)).pull.head).toBe(head);}
 await expect(run(['pr','create','--head=one','--head','two','-R','team/project'],f.io)).rejects.toThrow('one value');await expect(run(['run','list','--json=true','-R','team/project'],f.io)).rejects.toThrow('Unknown option');
});
test('native protection export/edit/delete preserve exact patterns and require an observed revision',async()=>{
 const f=fixture(),policy={branch:'検証/**',locked:true,approvals:0,checks:[]};let revision=8;
 f.io.fetcher=async(url,options)=>{f.requests.push({url,options});if(options.method!=='GET')revision++;return Response.json({revision,policies:[policy]});};
 await run(['rules','list','-R','team/project'],f.io);expect(f.output.at(-1)).toContain('Protection revision: 8');expect(f.output.at(-1)).toContain('locked');
 await run(['rules','get','検証/**','-R','team/project','--json'],f.io);const exported=JSON.parse(f.output.at(-1));expect(exported).toEqual({revision:8,policy});
 f.io.readProtectionFile=async path=>{expect(path).toBe('/fixture/edited policy.json');return JSON.stringify(exported);};
 await run(['rules','set','--file','edited policy.json','-R','team/project','--json'],f.io);expect(f.requests.at(-1).options.headers['If-Match']).toBe('"protection-8"');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual(policy);expect(JSON.parse(f.output.at(-1)).revision).toBe(9);
 await run(['rules','delete','検証/**','--revision','9','--confirm','検証/**','-R','team/project'],f.io);expect(f.requests.at(-1).options.method).toBe('DELETE');expect(f.requests.at(-1).options.headers['If-Match']).toBe('"protection-9"');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({branch:policy.branch});
 const count=f.requests.length;
 for(const args of [['rules','set'],['rules','delete','検証/**','--revision','10'],['rules','delete','検証/**','--revision','10','--confirm','wrong'],['rules','delete','検証/**','--revision','9007199254740992','--confirm','検証/**']])await expect(run([...args,'-R','team/project'],f.io)).rejects.toThrow();
 expect(f.requests.length).toBe(count);
});
test('protection file failures, unknown envelopes and lost responses never silently retry an edit',async()=>{
 const f=fixture();let calls=0;
 f.io.fetcher=async()=>{calls++;throw Error('lost');};
 for(const document of ['bad json','null','[]',JSON.stringify({revision:0,policy:{branch:'main'},bypass:true}),JSON.stringify({revision:-1,policy:{branch:'main'}})]) {
  f.io.readProtectionFile=async()=>document;await expect(run(['rules','set','--file','export.json','-R','team/project'],f.io)).rejects.toThrow();
 }
 expect(calls).toBe(0);
 f.io.readProtectionFile=async()=>JSON.stringify({revision:0,policy:{branch:'main'}});
 await expect(run(['rules','set','--file','export.json','-R','team/project'],f.io)).rejects.toThrow('Inspect rules get or rules list');expect(calls).toBe(1);
 const g=fixture();g.io.fetcher=async()=>Response.json({revision:1,policies:[{branch:'-leading'}]});
 await run(['rules','get','-R','team/project','--json','--','-leading'],g.io);expect(JSON.parse(g.output.at(-1)).policy.branch).toBe('-leading');
});

test('PR creation lets the server choose its current default and returns the newly created PR',async()=>{
 const f=fixture();f.io.fetcher=async(url,options)=>{f.requests.push({url,options});const body=JSON.parse(options.body);return Response.json({pulls:[{...f.view.pull,number:7,base:body.base??'trunk/日本語'},{...f.view.pull,number:1,base:'main'}]});};
 await run(['pr','create','--title','New PR','--head','feature','-R','team/project','--json'],f.io);
 expect(JSON.parse(f.requests.at(-1).options.body)).not.toHaveProperty('base');expect(JSON.parse(f.output.at(-1)).pull).toMatchObject({number:7,base:'trunk/日本語'});
 await run(['pr','create','--title','Explicit target','--head','feature','--base','release','-R','team/project','--json'],f.io);
 expect(JSON.parse(f.requests.at(-1).options.body).base).toBe('release');expect(JSON.parse(f.output.at(-1)).pull.base).toBe('release');
});

test('ruleset commands use separate revision headers, complete bypass-aware exports and explicit deletion confirmation',async()=>{
 const f=fixture(),configuration={name:'Branches',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'creation'}],bypass_actors:[]};
 f.io.fetcher=async(url,options)=>{f.requests.push({url,options});return Response.json(url.endsWith('/configuration')?{revision:7,configuration}:{revision:8,rulesets:[{...configuration,id:3}],ruleset:{...configuration,id:3}});};
 await run(['ruleset','list','-R','team/project'],f.io);expect(f.output.at(-1)).toContain('Ruleset revision: 8');
 await run(['ruleset','export','3','-R','team/project','--json'],f.io);const exported=JSON.parse(f.output.at(-1));expect(exported).toEqual({revision:7,configuration});
 f.io.readProtectionFile=async()=>JSON.stringify(exported);
 for(const args of [['ruleset','create'],['ruleset','update','3']]){await run([...args,'--file','ruleset.json','-R','team/project','--json'],f.io);expect(f.requests.at(-1).options.headers['If-Match']).toBe('"ruleset-7"');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({configuration});}
 await run(['ruleset','delete','3','--revision','8','--confirm','3','-R','team/project'],f.io);expect(f.requests.at(-1).options.method).toBe('DELETE');expect(JSON.parse(f.requests.at(-1).options.body)).toEqual({});
 const before=f.requests.length;
 for(const args of [['ruleset','delete','3','--revision','8'],['ruleset','delete','3','--revision','8','--confirm','4'],['ruleset','view','03'],['ruleset','create','--revision','8','--file','ruleset.json']])await expect(run([...args,'-R','team/project'],f.io)).rejects.toThrow();
 expect(f.requests.length).toBe(before);
});
test('incomplete ruleset exports and lost mutation responses do not silently replace or retry rules',async()=>{
 const f=fixture();let calls=0;f.io.fetcher=async()=>{calls++;throw Error('lost');};
 for(const value of [null,[],{revision:0,configuration:{name:'Missing bypass identities'}},{revision:0,configuration:{bypass_actors:[]},extra:true},{revision:-1,configuration:{bypass_actors:[]}}]){f.io.readProtectionFile=async()=>JSON.stringify(value);await expect(run(['ruleset','update','1','--file','ruleset.json','-R','team/project'],f.io)).rejects.toThrow();}
 expect(calls).toBe(0);f.io.readProtectionFile=async()=>JSON.stringify({revision:0,configuration:{bypass_actors:[]}});await expect(run(['ruleset','create','--file','ruleset.json','-R','team/project'],f.io)).rejects.toThrow('Inspect ruleset list or ruleset export');expect(calls).toBe(1);
});
