import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const names=['repository/codeowners','git','repository/store','repository/policy','review/store'];
const built=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{codeOwnerPattern,parseCodeOwners,codeOwnerEvidence,codeOwnerDecision},{encode,tree},{Repository},{Policies},{ReviewStore}]=await Promise.all(built.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40);
function graph(){
 const objects=new Map();
 const put=(type,body)=>{const bytes=typeof body==='string'?new TextEncoder().encode(body):body,o=encode(type,bytes);objects.set(o.sha,{type,body:bytes});return o.sha;};
 const blob=value=>put('blob',value);
 const makeTree=files=>{
  const entries=[],dirs=new Map();
  for(const [path,value] of Object.entries(files)){
   const slash=path.indexOf('/');
   if(slash<0)entries.push({name:path,sha:typeof value==='string'?value:value.sha,mode:typeof value==='string'?'100644':value.mode});
   else{const dir=path.slice(0,slash);if(!dirs.has(dir))dirs.set(dir,{});dirs.get(dir)[path.slice(slash+1)]=value;}
  }
  for(const [name,children] of dirs)entries.push({name,sha:makeTree(children),mode:'40000'});
  const o=tree(entries);objects.set(o.sha,{type:'tree',body:o.raw.subarray(o.raw.indexOf(0)+1)});return o.sha;
 };
 return {blob,makeTree,objects,body:async(sha,type)=>{const obj=objects.get(sha);assert.equal(obj?.type,type);return obj.body;}};
}
test('CODEOWNERS patterns follow root, basename, directory, wildcard, case and escaped-space examples',()=>{
 for(const [pattern,yes,no] of [
  ['*.js',['app.js','src/app.js'],['app.ts','src/App.JS']],
  ['/build/logs/',['build/logs/a.txt','build/logs/deep/a.txt'],['other/build/logs/a.txt']],
  ['docs/*',['docs/start.md'],['docs/deep/start.md','other/docs/start.md']],
  ['apps/',['apps/a.txt','nested/apps/deep/a.txt'],['apps','myapps/a.txt']],
  ['**/logs',['logs/a.txt','build/logs/a.txt','deep/build/logs/file'],['log/a.txt']],
  ['/apps/github',['apps/github/a.txt','apps/github/deep/a.txt'],['apps/other/a.txt']],
  ['docs/**/a?.md',['docs/a1.md','docs/deep/a日.md'],['docs/a12.md']],
  ['space\\ name.md',['space name.md','nested/space name.md'],['space-name.md']]
 ]){for(const path of yes)assert.equal(codeOwnerPattern(pattern,path),true,`${pattern}: ${path}`);for(const path of no)assert.equal(codeOwnerPattern(pattern,path),false,`${pattern}: ${path}`);}
 for(const pattern of ['!secret','[ab].js','\\#private'])assert.throws(()=>codeOwnerPattern(pattern,'anything'));
});
test('last valid matching line wins, ownerless lines unassign, and invalid lines are diagnosed',async()=>{
 const g=graph(),file=g.blob('* @global\n*.js @js @backup # comment\n/apps/ @apps\n/apps/github\n!secret @ignored\n[ab].js @ignored\n');
 const base={commit:sha('a'),tree:g.makeTree({'CODEOWNERS':file})};
 const head={commit:sha('b'),tree:g.makeTree({'CODEOWNERS':file,'src/a.js':g.blob('a'),'apps/main.js':g.blob('b'),'apps/github/index.js':g.blob('c'),'readme.md':g.blob('d')})};
 const proof=await codeOwnerEvidence(g,base,head);
 assert.equal(proof.error,undefined);assert.equal(proof.warnings.length,2);
 assert.deepEqual(proof.groups.find(g=>g.pattern==='*.js').owners,['@js','@backup']);
 assert.equal(proof.groups.find(g=>g.pattern==='/apps/').files,1);
 assert.equal(proof.groups.some(g=>g.paths.includes('apps/github/index.js')),false);
});
test('ownership uses the base file and location priority, including changes to CODEOWNERS itself',async()=>{
 const g=graph(),owners=g.blob('*.ts @reviewer\n/.github/CODEOWNERS @reviewer\n');
 const base={commit:sha('a'),tree:g.makeTree({'.github/CODEOWNERS':owners,'CODEOWNERS':g.blob('* @wrong'),'docs/CODEOWNERS':g.blob('* @also-wrong')})};
 const head={commit:sha('b'),tree:g.makeTree({'.github/CODEOWNERS':g.blob('* @author'),'CODEOWNERS':g.blob('* @wrong'),'docs/CODEOWNERS':g.blob('* @also-wrong'),'src/a.ts':g.blob('new')})};
 const proof=await codeOwnerEvidence(g,base,head);
 assert.equal(proof.file,'.github/CODEOWNERS');assert.equal(proof.groups.length,2);
 assert.ok(proof.groups.every(g=>g.owners[0]==='@reviewer'));assert.ok(proof.groups.some(g=>g.paths.includes('.github/CODEOWNERS')));
});
test('binary changes, removed paths and modes are checked beyond the UI diff truncation',async()=>{
 const g=graph(),file=g.blob('* @reviewer'),data=g.blob(new Uint8Array([0,255]));
 const baseFiles={'CODEOWNERS':file,'old.bin':data,'run':{sha:data,mode:'100644'}},nextFiles={'CODEOWNERS':file,'run':{sha:data,mode:'100755'}};
 for(let n=0;n<3100;n++)nextFiles[`asset-${n}.bin`]=data;
 const proof=await codeOwnerEvidence(g,{commit:sha('a'),tree:g.makeTree(baseFiles)},{commit:sha('b'),tree:g.makeTree(nextFiles)});
 assert.equal(proof.error,undefined);assert.equal(proof.groups[0].files,3102);assert.equal(proof.groups[0].paths.length,3);
});
test('one approval per matched ownership group suffices; unsupported owner kinds never silently waive a gate',()=>{
 const evidence={base:sha('a'),head:sha('b'),file:'CODEOWNERS',warnings:[],groups:[
  {line:1,pattern:'src/**',owners:['@a','@b'],files:3,paths:['src/a']},
  {line:2,pattern:'docs/**',owners:['@c'],files:1,paths:['docs/a']},
 ]};
 const accounts={'@a':'alice','@b':'bob','@c':'carol'};
 assert.equal(codeOwnerDecision(evidence,accounts,['alice'],true).missing,1);
 assert.equal(codeOwnerDecision(evidence,accounts,['bob','carol'],true).missing,0);
 assert.equal(codeOwnerDecision(evidence,{...accounts,'@b':null},['bob','carol'],true).missing,1,'A former writer cannot approve for a still-owned group');
 const unsupported={...evidence,groups:[{...evidence.groups[0],owners:['@organization/team']}]};
 assert.equal(codeOwnerDecision(unsupported,{},[],true).missing,1);
 assert.match(codeOwnerDecision(unsupported,{},[],true).warnings[0].message,/not mapped/);
 const unknown={...evidence,groups:[{...evidence.groups[0],owners:['@missing']}]};
 assert.equal(codeOwnerDecision(unknown,{},[],true).missing,0,'Unknown individual handles are unassigned as on GitHub');
});
test('missing/oversized files have no assignments; unreadable files and evaluation exhaustion report blocking errors',async()=>{
 const g=graph(),empty=g.makeTree({}),base={commit:sha('a'),tree:empty},head={commit:sha('b'),tree:g.makeTree({'a':g.blob('x')})};
 assert.equal((await codeOwnerEvidence(g,base,head)).file,null);
 const huge=g.makeTree({'CODEOWNERS':g.blob(new Uint8Array(3*1024*1024))});
 const oversized=await codeOwnerEvidence(g,{...base,tree:huge},head);assert.equal(oversized.groups.length,0);assert.match(oversized.warnings[0].message,/not loaded/);
 const link=g.makeTree({'CODEOWNERS':{sha:g.blob('target'),mode:'120000'}});
 assert.match((await codeOwnerEvidence(g,{...base,tree:link},head)).error,/regular file/);
 const rules=g.blob('*'.repeat(4096)+' @reviewer'),path='a'.repeat(6000);
 const exhausted=await codeOwnerEvidence(g,{...base,tree:g.makeTree({'CODEOWNERS':rules})},{...head,tree:g.makeTree({'CODEOWNERS':rules,[path]:g.blob('x')})});
 assert.match(exhausted.error,/evaluation limit/);assert.equal(exhausted.groups.length,0);
});

test('the final merge gate binds evidence, rejects author/agent approvals and composes overlapping owner requirements',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 try{
  sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
  const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'owner');
  repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
  const reviews=new ReviewStore(sql,()=>repo.main(),true,{accounts:{reviewer:"writer",author:"writer"},checkedAt:Date.now(),expiresAt:Date.now()+30000}),policies=new Policies(sql);
  policies.set({branch:'*',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:false,preventDelete:true,requireCodeOwnerReview:true});
  policies.set({branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:false,preventDelete:true,requireCodeOwnerReview:false});
  assert.equal(policies.get('main').requireCodeOwnerReview,true);
  assert.throws(()=>repo.update('refs/heads/main',sha('a'),{commit:sha('c'),tree:sha('3')},true,'owner'),/reviewed pull request/);
  const branch=name=>reviews.snapshot().branches.find(b=>b.name===name);
  reviews.run({op:'open',title:'Change',body:'',head:branch('feature'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'Author'}},()=>{});
  const evidence={base:sha('a'),head:sha('b'),file:'CODEOWNERS',warnings:[],groups:[{line:1,pattern:'*',owners:['@reviewer'],files:1,paths:['x']}]};
  const merge=extra=>reviews.run({op:'merge',number:1,head:branch('feature'),base:repo.main(),anchor:sha('a'),candidate:{commit:sha('b'),tree:sha('2'),base:sha('a')},request:{owner:{id:'owner'}},...extra},()=>{throw Error('Unexpected landing');});
  assert.throws(()=>merge({}),/CODEOWNERS evidence/);
  assert.throws(()=>merge({codeOwners:{...evidence,base:sha('f')},codeOwnerAccounts:{'@reviewer':'reviewer'}}),/CODEOWNERS evidence/);
  const approve=(id,independent)=>reviews.run({op:'review',number:1,author:{id,name:id},body:'',verdict:'APPROVE',commit:sha('b'),anchor:sha('a'),independent},()=>{});
  approve('author',true);approve('reviewer',false);
  assert.throws(()=>merge({codeOwners:evidence,codeOwnerAccounts:{'@reviewer':'reviewer'}}),/code owner approval/);
  approve('reviewer',true);
  const merged=merge({codeOwners:evidence,codeOwnerAccounts:{'@reviewer':'reviewer'}});
  assert.equal(merged.pulls[0].state,'merged');assert.equal(merged.pulls[0].codeOwners.missing,0);assert.equal(repo.main().commit,sha('b'));
 }finally{db.close();}
});
