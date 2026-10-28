import {test,expect} from 'bun:test';
import {run} from '../src/main.mjs';
const token='nhc_'+'b'.repeat(64),base='a'.repeat(40),head='b'.repeat(40),tail=['-R','team/project','--json'];
test('generated CLI merges bind observed target/head, choose one advertised method and never send proof claims',async()=>{
 const requests=[],output=[],view={mergeMethods:['fast-forward','merge','squash','rebase'],branches:[{name:'main',commit:base}],head:{commit:head},pull:{number:1,base:'main',anchor:base}};
 const io={environment:{NANOHUB_API_TOKEN:token},write:value=>output.push(value),fetcher:async(url,options)=>{requests.push({url,options});return Response.json(options.method==='GET'?view:{pulls:[{...view.pull,state:'merged',mergedCommit:'c'.repeat(40)}]});}};
 for(const flag of ['--merge','--squash','--rebase']){await run(['pr','merge','1',flag,...tail],io);const body=JSON.parse(requests.at(-1).options.body);expect(body).toEqual({commit:head,anchor:base,method:flag.slice(2),targetBase:base});expect(JSON.parse(output.at(-1)).pull.mergedCommit).toBe('c'.repeat(40));}
 await run(['pr','merge','1','--method','squash','--message','Custom\n\nBody',...tail],io);expect(JSON.parse(requests.at(-1).options.body).message).toBe('Custom\n\nBody');
});
test('invalid merge flags/messages, old receivers and missing target observations fail without mutation',async()=>{
 let calls=0;const io={environment:{NANOHUB_API_TOKEN:token},write:()=>{},fetcher:async()=>{calls++;return Response.json({head:{commit:head},pull:{number:1,base:'main',anchor:base}});}};
 for(const command of [
  ['pr','merge','1','--merge','--squash'],['pr','merge','1','--method','merge','--rebase'],['pr','merge','1','--method','other'],
  ['pr','view','1','--squash'],['pr','merge','1','--message','Unselected'],['pr','merge','1','--rebase','--message','Dropped'],
  ['pr','merge','1','--squash','--message',''],['pr','merge','1','--squash','--message','NUL\0'],['pr','merge','1','--squash','--message','x'.repeat(65537)]
 ])await expect(run([...command,...tail],io)).rejects.toThrow();expect(calls).toBe(0);
 await expect(run(['pr','merge','1','--squash',...tail],io)).rejects.toThrow('unavailable');expect(calls).toBe(1);
 io.fetcher=async()=>{calls++;return Response.json({mergeMethods:['squash'],head:{commit:head},pull:{number:1,base:'main',anchor:base}});};
 await expect(run(['pr','merge','1','--squash',...tail],io)).rejects.toThrow('target branch');expect(calls).toBe(2);
});
