import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const token='nhc_'+'a'.repeat(64),sha=c=>c.repeat(40);
function fixture(extra={}){
  const calls=[],output=[],pull={number:1,state:'open',draft:true,draftRevision:2,title:'A draft',head:'topic',base:'main',anchor:sha('a'),...extra};
  return {calls,output,io:{cwd:'/fixture',environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),execute:async()=>{throw Error('No browser or source command');},fetcher:async(url,options)=>{
    calls.push({url,options});return Response.json({pullReadiness:'storage-v1',pull,head:{commit:sha('b')},pulls:[pull]});
  }}};
}
test('draft creation uses capability discovery and a distinct route that old servers cannot treat as ready creation',async()=>{
  const f=fixture();await run(['pr','create','--title','A draft','--head','topic','--draft','-R','owner/repo','--json'],f.io);
  expect(f.calls.map(c=>[new URL(c.url).pathname,c.options.method])).toEqual([['/api/cli/repos/owner/repo/pulls','GET'],['/api/cli/repos/owner/repo/pulls/drafts','POST']]);
  expect(JSON.parse(f.calls[1].options.body)).toEqual({title:'A draft',head:'topic',body:''});expect(f.output.join('')).not.toContain(token);
});
test('ready and undo bind the current head, anchor and monotonic draft revision to one conditional write',async()=>{
  for(const undo of [false,true]){const f=fixture();await run(['pr','ready','1',...(undo?['--undo']:[]),'-R','owner/repo'],f.io);
    const c=f.calls.at(-1);expect(c.options.method).toBe('POST');expect(c.options.headers['If-Match']).toBe('"pull-readiness-2"');expect(JSON.parse(c.options.body)).toEqual({draft:undo,revision:2,commit:sha('b'),anchor:sha('a')});
  }
});
test('old capabilities, stale revisions, closed PRs and misplaced flags never send lifecycle mutations',async()=>{
  for(const args of [['ready','1','--revision','1'],['ready','1','--revision','2.0'],['view','1','--undo'],['create','--title','A draft','--head','topic','--undo']]){const f=fixture();await expect(run(['pr',...args,'-R','owner/repo'],f.io)).rejects.toThrow();expect(f.calls.some(c=>c.options.method!=='GET')).toBe(false);}
  for(const args of [['ready','1'],['create','--title','A draft','--head','topic','--draft']]){const f=fixture();f.io.fetcher=async(url,options)=>{f.calls.push({url,options});return Response.json({pull:{state:'open',draft:true,draftRevision:0}});};await expect(run(['pr',...args,'-R','owner/repo'],f.io)).rejects.toThrow(/unavailable/);expect(f.calls.some(c=>c.options.method!=='GET')).toBe(false);}
  const f=fixture({state:'closed'});await expect(run(['pr','ready','1','-R','owner/repo'],f.io)).rejects.toThrow('Only open');expect(f.calls.length).toBe(1);
});
test('an uncertain ready response is never replayed, and list/view identify draft PRs without altering JSON state',async()=>{
  const f=fixture(),fetcher=f.io.fetcher;f.io.fetcher=async(url,options)=>{if(options.method!=='GET'){f.calls.push({url,options});throw Error('lost '+token);}return fetcher(url,options);};
  await expect(run(['pr','ready','1','-R','owner/repo'],f.io)).rejects.toThrow('Inspect the pull request');expect(f.calls.filter(c=>c.options.method==='POST').length).toBe(1);expect(f.output.join('')).not.toContain(token);
  const list=fixture();await run(['pr','list','-R','owner/repo'],list.io);expect(list.output[0]).toContain('\tdraft\t');
  const view=fixture();await run(['pr','view','1','-R','owner/repo'],view.io);expect(view.output[0]).toContain('draft · topic');
});
