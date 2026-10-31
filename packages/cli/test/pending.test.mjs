import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const args=['-R','team/project','--json'];
test('private review mutations require explicit valid revisions and reject mixed modes before any request',async()=>{
 let calls=0;const io={environment:{NANOHUB_API_TOKEN:'nhc_'+'b'.repeat(64)},fetcher:async()=>{calls++;throw Error('Should not request');},write:()=>{}};
 for(const command of [
  ['pr','comment','1','--draft','--body','Private','--path','a','--line','1'],
  ['pr','review','1','--pending','--revision','-1'],
  ['pr','review','1','--pending','--revision','9007199254740992'],
  ['pr','review','1','--pending','--revision','1','--verdict','other'],
  ['pr','draft','1','--edit','comment-id','--revision','1'],
  ['pr','draft','1','--discard','--remove','comment-id','--revision','1'],
  ['pr','comment','1','--draft','--revision','0','--reply-to','public-thread'],
  ['pr','draft','1','--body','Accidental publication'],
  ['pr','review','1','--draft'],['pr','comment','1','--pending'],
  ['pr','merge','1','--discard'],['pr','review','1','--revision','1'],
  ['pr','draft','1','--revision','1'],['pr','draft','1','--discard','--revision','1','--confirm','x'],
  ['pr','comment','1','--draft','--revision','0','--body','Large','--path','a','--line','202','--start-line','1']
 ])await expect(run([...command,...args],io)).rejects.toThrow();
 expect(calls).toBe(0);
});
test('changed draft revision is refused locally; no write or silent retry after a lost publication response',async()=>{
 const requests=[],pending={id:'private-review-1',revision:3,commit:'b'.repeat(40),anchor:'a'.repeat(40),comments:[{id:'private-comment-1'}]};
 const io={environment:{NANOHUB_API_TOKEN:'nhc_'+'b'.repeat(64)},write:()=>{},fetcher:async(url,options)=>{requests.push({url,options});if(options.method==='GET')return Response.json({pending});throw Error('Lost response');}};
 await expect(run(['pr','review','1','--pending','--revision','2',...args],io)).rejects.toThrow('changed');expect(requests.length).toBe(1);
 await expect(run(['pr','review','1','--pending','--revision','3','--verdict','approve',...args],io)).rejects.toThrow('response was lost');expect(requests.filter(r=>r.options.method==='POST').length).toBe(1);
 const body=JSON.parse(requests.at(-1).options.body);expect(body).toEqual({reviewId:pending.id,revision:3,commit:pending.commit,anchor:pending.anchor,verdict:'APPROVE',body:''});
});
test('published private reader feedback is identified in text and remains lossless in JSON',async()=>{
 const pending={id:'reader-review-1',revision:1,commit:'b'.repeat(40),anchor:'a'.repeat(40),comments:[{id:'reader-comment-1'}]},receipt={pending:null,reviewId:7,feedback:{role:'reader',verdict:'REQUEST_CHANGES'}},output=[];
 const io={environment:{NANOHUB_API_TOKEN:'nhc_'+'b'.repeat(64)},write:value=>output.push(value),fetcher:async(url,options)=>Response.json(options.method==='GET'?{pending}:receipt)};
 const command=['pr','review','1','--pending','--revision','1','--verdict','request-changes','-R','team/project'];
 await run(command,io);expect(output.at(-1)).toContain('Reader feedback only; required approvals need writer access.');await run([...command,'--json'],io);expect(JSON.parse(output.at(-1))).toEqual(receipt);
});
