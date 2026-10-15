import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({entryPoints:['src/importer.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {importGitHubContext} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const requested=[];
const issue=(number,state='open')=>({number,title:`Issue ${number}`,body:'body',state,labels:[],user:{login:'person'},created_at:'2026-01-01',comments:0,html_url:`https://github.com/owner/repo/issues/${number}`});
globalThis.fetch=async(url,options)=>{
  const u=new URL(url); requested.push(u);
  assert.equal(u.origin,'https://api.github.com');
  assert.equal(options.headers.Authorization,'Bearer test-token');
  if(u.pathname.endsWith('/issues')) {
    const page=u.searchParams.get('page');
    const closed=u.searchParams.get('state')==='closed';
    return Response.json([issue(closed?3:page==='1'?1:2,closed?'closed':'open')], {headers:!closed&&page==='1'?{Link:'<https://untrusted.example/steal>; rel="next"'}:{}});
  }
  if(u.pathname.endsWith('/pulls')) return Response.json([]);
  return Response.json({full_name:'owner/repo',default_branch:'main',html_url:'https://github.com/owner/repo'});
};
const result=await importGitHubContext('owner','repo','test-token');
assert.deepEqual(result.issues.map(i=>i.number),[1,2,3]);
assert.deepEqual(result.notes,[]);
assert.equal(requested.filter(u=>u.searchParams.get('page')==='2').length,1);
console.log('PASS: context follows all pages without forwarding credentials to Link URLs');
