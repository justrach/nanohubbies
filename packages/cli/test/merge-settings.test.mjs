import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const token='nhc_'+'b'.repeat(64),tail=['-R','team/project','--json'];
const configuration=()=>({mode:'git',allowedMethods:['fast-forward','merge','squash','rebase'],defaultMethod:'fast-forward',revision:3,conditionalWrites:true,cliAudit:true,revisionTracking:'storage',canManage:true,readOnly:false});
test('merge settings read and edit use the native API, current revision and an explicit full replacement',async()=>{
 const requests=[],output=[];let data=configuration();
 const io={environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),fetcher:async(url,options)=>{
  requests.push({url,options});if(options.method==='PUT'){const body=JSON.parse(options.body);data={...data,...body,revision:4};}return Response.json(data);
 }};
 await run(['repo','merge-settings',...tail],io);expect(JSON.parse(output.at(-1)).revision).toBe(3);
 await run(['repo','edit','--allow-merge-methods','squash,fast-forward','--default-merge-method','squash','--revision','3',...tail],io);
 expect(requests.at(-1).url).toEndWith('/merge-settings');expect(requests.at(-1).options.headers['If-Match']).toBe('"merge-settings-3"');
 expect(JSON.parse(requests.at(-1).options.body)).toEqual({allowedMethods:['fast-forward','squash'],defaultMethod:'squash',revision:3});
 expect(JSON.parse(output.at(-1)).revision).toBe(4);
});
test('invalid flags and configurations are refused before any settings request',async()=>{
 let calls=0;const io={environment:{NANOHUB_API_TOKEN:token},write:()=>{},fetcher:async()=>{calls++;return Response.json(configuration());}};
 for(const command of [
  ['repo','edit','--allow-merge-methods','squash'],
  ['repo','edit','--allow-merge-methods','merge','--default-merge-method','squash','--revision','3'],
  ['repo','edit','--allow-merge-methods','merge,merge','--default-merge-method','merge','--revision','3'],
  ['repo','edit','--allow-merge-methods','','--default-merge-method','merge','--revision','3'],
  ['repo','edit','--allow-merge-methods','squash','--default-merge-method','squash','--revision','-1'],
  ['repo','edit','--allow-merge-methods','squash','--default-merge-method','squash','--revision','3','--default-branch','main'],
  ['repo','merge-settings','--revision','3'],['pr','list','--allow-merge-methods','squash'],['repo','merge-settings','--web'],
 ])await expect(run([...command,...tail],io)).rejects.toThrow();
 expect(calls).toBe(0);
});
test('old receivers, stale revisions, archived repos and missing admin grants never receive a settings write',async()=>{
 for(const patch of [{conditionalWrites:false},{revisionTracking:'manual'},{revision:4},{readOnly:true},{canManage:false},{mode:'snapshot'}]){
  const requests=[];const io={environment:{NANOHUB_API_TOKEN:token},write:()=>{},fetcher:async(url,options)=>{requests.push(options.method);return Response.json({...configuration(),...patch});}};
  await expect(run(['repo','edit','--allow-merge-methods','squash','--default-merge-method','squash','--revision','3',...tail],io)).rejects.toThrow();
  expect(requests).toEqual(['GET']);
 }
});
test('a lost settings response never retries or reports success',async()=>{
 const requests=[],output=[];const io={environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),fetcher:async(url,options)=>{requests.push(options.method);if(options.method==='PUT')throw Error('response lost');return Response.json(configuration());}};
 await expect(run(['repo','edit','--allow-merge-methods','squash','--default-merge-method','squash','--revision','3',...tail],io)).rejects.toThrow('Inspect repo merge-settings');
 expect(requests).toEqual(['GET','PUT']);expect(output).toEqual([]);
});
test('ordinary PR merge uses the repository default, binds observed settings and refuses disabled explicit fast-forward',async()=>{
 const requests=[],view={mergeSettings:{...configuration(),allowedMethods:['squash'],defaultMethod:'squash'},mergeMethods:['squash'],branches:[{name:'main',commit:'a'.repeat(40)}],head:{commit:'b'.repeat(40)},pull:{number:1,base:'main',anchor:'a'.repeat(40)}};
 const io={environment:{NANOHUB_API_TOKEN:token},write:()=>{},fetcher:async(url,options)=>{requests.push(options);return Response.json(options.method==='GET'?view:{pulls:[{...view.pull,state:'merged'}]});}};
 await run(['pr','merge','1',...tail],io);
 expect(JSON.parse(requests.at(-1).body)).toEqual({commit:'b'.repeat(40),anchor:'a'.repeat(40),method:'squash',targetBase:'a'.repeat(40),mergeSettingsRevision:3});
 const writes=requests.filter(request=>request.method==='POST').length;
 await expect(run(['pr','merge','1','--method','fast-forward',...tail],io)).rejects.toThrow();
 expect(requests.filter(request=>request.method==='POST').length).toBe(writes);
 view.mergeSettings={...configuration(),allowedMethods:['fast-forward'],defaultMethod:'fast-forward'};view.mergeMethods=['fast-forward'];
 await run(['pr','merge','1',...tail],io);expect(JSON.parse(requests.at(-1).body).method).toBe('fast-forward');expect(JSON.parse(requests.at(-1).body).mergeSettingsRevision).toBe(3);
});
