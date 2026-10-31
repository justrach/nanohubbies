import {test,expect} from 'bun:test';import {run} from '../src/main.mjs';import {apiRequest} from '../src/api.mjs';
const token='nhc_'+'a'.repeat(64),sha=c=>c.repeat(40);
function fixture(){const calls=[],output=[];return{calls,output,io:{cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),execute:async()=>{throw Error('No browser or source command');},fetcher:async(url,options)=>{calls.push({url,options});return Response.json(url.endsWith('/pulls/1')?{pull:{anchor:sha('a')},head:{commit:sha('b')}}:{protocol:1,revision:3,requests:[]});}}};}
test('reviewer commands carry explicit revision and current diff, never credentials in output',async()=>{
 for(const [action,method]of [['request-review','POST'],['remove-reviewer','DELETE']]){const f=fixture();await run(['pr',action,'1','--reviewer','codegraff:writer,codegraff:backup','--revision','2','-R','owner/repo','--json'],f.io);const call=f.calls.at(-1);expect(call.options.method).toBe(method);expect(call.options.headers['If-Match']).toBe('"review-requests-2"');expect(JSON.parse(call.options.body)).toEqual({reviewers:['codegraff:writer','codegraff:backup'],revision:2,commit:sha('b'),anchor:sha('a')});expect(call.options.credentials).toBe('omit');expect(call.options.redirect).toBe('error');expect(f.output.join('')).not.toContain(token);}
});
test('reviewer list is a native read and rejects malformed or misplaced edit flags without mutations',async()=>{
 const f=fixture();await run(['pr','reviewers','1','-R','owner/repo','--json'],f.io);expect(f.calls.length).toBe(1);expect(f.calls[0].options.method).toBe('GET');
 for(const args of [['request-review','1'],['request-review','1','--reviewer','a,a','--revision','0'],['remove-reviewer','1','--reviewer','a','--revision','1.0'],['reviewers','../bad'],['request-review','1','--web'],['view','1','--reviewer','ignored']]){const f=fixture();await expect(run(['pr',...args,'-R','owner/repo'],f.io)).rejects.toThrow();expect(f.calls.some(call=>call.options.method!=='GET')).toBe(false);}
});
test('an uncertain reviewer edit is never replayed automatically',async()=>{
 let calls=0;await expect(apiRequest('https://nanohub.sh','/api/cli/trunks/fixture/pulls/1/requested-reviewers',token,{method:'POST',body:{},fetcher:async()=>{calls++;throw Error('lost '+token);}})).rejects.toThrow('Inspect the pull request');expect(calls).toBe(1);
});
