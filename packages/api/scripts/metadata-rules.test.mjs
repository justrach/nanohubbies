import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const names=['repository/metadata-pattern','repository/rulesets','repository/rule-proof','repository/store','repository/ruleset-transfer','git'];
const built=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{validateMetadataParameters,metadataMatcher},{Rulesets,validateRuleset},{repositoryProof},{Repository},{importRuleset,exportRuleset},{encode,tree}]=await Promise.all(built.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const pattern=(type,operator,value,extra={})=>({type,parameters:{operator,pattern:value,...extra}});
const input=(rules,extra={})=>({name:'Metadata consistency',target:'branch',enforcement:'active',conditions:{ref_name:{include:['~ALL'],exclude:[]}},rules,...extra});
function graph(){
 const objects=new Map(),put=(type,body)=>{const o=encode(type,new TextEncoder().encode(body));objects.set(o.sha,{type,body:o.raw.subarray(o.raw.indexOf(0)+1)});return o.sha;};
 const root=tree([]);objects.set(root.sha,{type:'tree',body:root.raw.subarray(root.raw.indexOf(0)+1)});
 const commit=(message,parents=[],author='author@example.invalid',committer='committer@example.invalid')=>put('commit',`tree ${root.sha}\n${parents.map(p=>`parent ${p}\n`).join('')}author Fixture <${author}> 1 +0000\ncommitter Fixture <${committer}> 1 +0000\n\n${message}`);
 const tag=sha=>put('tag',`object ${sha}\ntype ${objects.get(sha).type}\ntag v1\ntagger Fixture <fixture@example.invalid> 1 +0000\n\nTag\n`);
 return{objects,put,root:root.sha,commit,tag,get:async sha=>objects.get(sha)??null};
}
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();return{db,sql,repo,rules:new Rulesets(sql)};
}
test('metadata operators are literal/case-sensitive unless RE2 is selected, with independent negation',()=>{
 const matches=metadataMatcher();
 assert.equal(matches({operator:'contains',pattern:'a*'},'abc'),false);assert.equal(matches({operator:'contains',pattern:'a*'},'a*b'),true);
 assert.equal(matches({operator:'starts_with',pattern:'feat:'},'feat: add API\n'),true);assert.equal(matches({operator:'ends_with',pattern:'ok'},'OK'),false);
 assert.equal(matches({operator:'contains',pattern:'WIP',negate:true},'feat: done'),true);assert.equal(matches({operator:'contains',pattern:'WIP',negate:true},'WIP: work'),false);
 assert.equal(matches({operator:'regex',pattern:'^feat: .+\\n?$'},'feat: add API\n'),true);
 assert.equal(matches({operator:'regex',pattern:'(?m)^Signed-off-by: .+@example\\.invalid$'},'feat: done\n\nSigned-off-by: A <a@example.invalid>\n'),false);
 assert.equal(matches({operator:'regex',pattern:'(?m)^Signed-off-by: .+example\\.invalid>\\n?$'},'feat: done\n\nSigned-off-by: A <a@example.invalid>\n'),true);
 assert.equal(matches({operator:'regex',pattern:'^(a+)+$'},'a'.repeat(100_000)+'!'),false,'Nested quantifiers use bounded RE2 matching, not native catastrophic backtracking');
});
test('regex/schema resource limits reject unsupported syntax, huge expansion and invalid fields',()=>{
 for(const pattern of ['(?=a)','(a)\\1','[','a{1001}','(a{1000}){1000}'])assert.throws(()=>validateMetadataParameters({operator:'regex',pattern}),/RE2|regex/);
 for(const value of [{operator:'glob',pattern:'*'},{operator:'contains',pattern:''},{operator:'contains',pattern:'a'.repeat(513)},{operator:'contains',pattern:'a',negate:'true'},{operator:'contains',pattern:'a',extra:true}])assert.throws(()=>validateMetadataParameters(value),/Metadata/);
 assert.throws(()=>metadataMatcher()({operator:'regex',pattern:'a{1000}'},'a'.repeat(30000)),/evaluation limit/);
 assert.throws(()=>validateRuleset(input([pattern('tag_name_pattern','contains','v')])),/target/);
 assert.throws(()=>validateRuleset(input([pattern('branch_name_pattern','regex','(',{name:'Branch convention'})])),/Branch convention:.*RE2/);
 assert.throws(()=>validateRuleset(input([pattern('commit_message_pattern','contains','x')],{target:'push',conditions:undefined})),/Unsupported push/);
});
test('multiple metadata restrictions survive portable import/export without being silently dropped',()=>{
 const body=input([pattern('commit_message_pattern','starts_with','feat:',{name:'Conventional subject'}),pattern('commit_message_pattern','contains','WIP',{negate:true}),pattern('branch_name_pattern','regex','^(main|feature/.+)$')]);
 const validated=validateRuleset(body);assert.equal(validated.rules.length,3);assert.deepEqual(importRuleset(exportRuleset({...validated,id:123})).configuration,validated);
});
test('branch and tag names are checked synchronously while deletion can clean up nonconforming names',()=>{
 const f=fixture();try{
  const sha='a'.repeat(40);f.repo.update('refs/heads/bad',null,{commit:sha,tree:'1'.repeat(40)},false,'owner');
  f.rules.set(input([pattern('branch_name_pattern','regex','^(main|feature/.+)$')]));
  assert.throws(()=>f.repo.update('refs/heads/other',null,{commit:sha,tree:'1'.repeat(40)},false,'owner'),/ref name/);
  f.repo.update('refs/heads/feature/good',null,{commit:sha,tree:'1'.repeat(40)},false,'owner');f.repo.update('refs/heads/bad',sha,null,false,'owner');
  f.rules.set(input([pattern('tag_name_pattern','starts_with','v')],{target:'tag'}));assert.throws(()=>f.repo.update('refs/tags/release',null,{commit:sha,tree:''},false,'owner'),/ref name/);f.repo.update('refs/tags/v1',null,{commit:sha,tree:''},false,'owner');
 }finally{f.db.close();}
});
test('all introduced commit messages and merge side parents are checked; existing ancestry is grandfathered',async()=>{
 const f=fixture(),g=graph();try{
  const a=g.commit('old subject\n'),bad=g.commit('WIP: hidden\n',[a]),good=g.commit('feat: tip\n',[bad]);
  const rule=f.rules.set(input([pattern('commit_message_pattern','starts_with','feat:')]));
  const proof=await repositoryProof(g.get,a,good,f.rules.plan(),'refs/heads/main');assert.ok(proof.rules.violations.some(v=>v.message.includes(bad.slice(0,12))));
  const left=g.commit('feat: left\n',[a]),right=g.commit('bad side\n',[a]),merge=g.commit('feat: merge\n',[left,right]);
  assert.ok((await repositoryProof(g.get,left,merge,f.rules.plan(),'refs/heads/main')).rules.violations.some(v=>v.message.includes(right.slice(0,12))));
  const clean=g.commit('feat: clean\n',[a]);assert.deepEqual((await repositoryProof(g.get,a,clean,f.rules.plan(),'refs/heads/main')).rules.violations,[]);
  const create=await repositoryProof(g.get,null,clean,f.rules.plan(),'refs/heads/new');assert.ok(create.rules.violations.length,'New refs check reachable history');
  const {id,...configuration}=rule;f.rules.set({...configuration,enforcement:'disabled'},id);
 }finally{f.db.close();}
});
test('author and committer email restrictions differ, full messages retain trailers/newlines, and tags peel to commits',async()=>{
 const f=fixture(),g=graph();try{
  const saved=f.rules.set(input([pattern('commit_author_email_pattern','ends_with','@example.invalid'),pattern('committer_email_pattern','ends_with','@trusted.invalid'),pattern('commit_message_pattern','regex','(?m)^Signed-off-by: .+example\\.invalid>\\n?$')],{target:'tag'}));
  const good=g.commit('feat: done\n\nSigned-off-by: A <a@example.invalid>\n',[],'a@example.invalid','ci@trusted.invalid'),tag=g.tag(g.tag(good));
  assert.deepEqual((await repositoryProof(g.get,null,tag,f.rules.plan(),'refs/tags/v1')).rules.violations,[]);
  const bad=g.commit('feat: done\n\nSigned-off-by: A <a@example.invalid>\n',[],'a@example.invalid','ci@example.invalid');assert.match((await repositoryProof(g.get,null,g.tag(bad),f.rules.plan(),'refs/tags/v2')).rules.violations[0].message,/committer_email/);
  const blob=g.put('blob','text');assert.match((await repositoryProof(g.get,null,g.tag(blob),f.rules.plan(),'refs/tags/v3')).rules.violations[0].message,/pointing to a commit/);
  f.rules.set(input([pattern('commit_author_email_pattern','contains','blocked',{negate:true})],{target:'tag'}),saved.id);
  const missing=g.put('commit',`tree ${g.root}\ncommitter Fixture <ci@trusted.invalid> 1 +0000\n\nMessage\n`);
  assert.match((await repositoryProof(g.get,null,g.tag(missing),f.rules.plan(),'refs/tags/v4')).rules.violations[0].message,/unverifiable/,'Negation cannot accept a missing identity');
  const badEncoding=encode('commit',new Uint8Array([...new TextEncoder().encode(`tree ${g.root}\nauthor A <a@example.invalid> 1 +0000\ncommitter C <ci@trusted.invalid> 1 +0000\n\n`),255]));
  g.objects.set(badEncoding.sha,{type:'commit',body:badEncoding.raw.subarray(badEncoding.raw.indexOf(0)+1)});
  assert.match((await repositoryProof(g.get,null,g.tag(badEncoding.sha),f.rules.plan(),'refs/tags/v5')).rules.violations[0].message,/unverifiable/);
 }finally{f.db.close();}
});
test('final metadata enforcement binds ref, old/new IDs and policy revision, without agent bypass inheritance',async()=>{
 const f=fixture(),g=graph();try{
  const a=g.commit('base\n'),b=g.commit('feat: good\n',[a]);f.repo.update('refs/heads/main',null,{commit:a,tree:g.root},false,'owner');
  const rule=f.rules.set(input([pattern('commit_message_pattern','starts_with','feat:')]));const proof=await repositoryProof(g.get,a,b,f.rules.plan(),'refs/heads/main');
  assert.throws(()=>f.repo.update('refs/heads/main',a,{commit:b,tree:g.root},true,'owner',false,{...proof,rules:{...proof.rules,ref:'refs/heads/elsewhere'}}),/another ref/);
  f.rules.set(input([pattern('commit_message_pattern','contains','required trailer')]),rule.id);assert.throws(()=>f.repo.update('refs/heads/main',a,{commit:b,tree:g.root},true,'owner',false,proof),/evidence/);
  const current=await repositoryProof(g.get,a,b,f.rules.plan(),'refs/heads/main');assert.throws(()=>f.repo.update('refs/heads/main',a,{commit:b,tree:g.root},true,'owner',false,current),/does not satisfy/);
  f.rules.set(input([pattern('commit_message_pattern','contains','required trailer')],{bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]}),rule.id);
  const bad=await repositoryProof(g.get,a,b,f.rules.plan(),'refs/heads/main');assert.throws(()=>f.repo.update('refs/heads/main',a,{commit:b,tree:g.root},true,'owner',false,bad,false),/does not satisfy/);
  f.repo.update('refs/heads/main',a,{commit:b,tree:g.root},true,'owner',false,bad,true);assert.deepEqual(f.repo.activity({kind:'bypasses'}).events[0].bypassedRulesets,[rule.id]);
 }finally{f.db.close();}
});
