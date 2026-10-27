import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const names=['repository/rulesets','repository/rule-proof','repository/store','repository/policy','git','review/store','repository/pattern'];
const output=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const modules=await Promise.all(output.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const [{Rulesets,validateRuleset},{repositoryProof},{Repository},{Policies},{encode,tree},{ReviewStore},{matchesGlob}]=modules;
const sha=c=>c.repeat(40);
function fixture(){
 const db=new DatabaseSync(':memory:'); const sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'owner');
 return{db,sql,repo,rules:new Rulesets(sql)};
}
const input=(extra={})=>({name:'Release protection',target:'tag',enforcement:'active',conditions:{ref_name:{include:['refs/tags/v[0-9]*'],exclude:['refs/tags/v0*']}},rules:[{type:'creation'},{type:'update'},{type:'deletion'}],...extra});
const push=rules=>input({target:'push',conditions:undefined,name:'File safety',rules});
test('rulesets target tags, exclusions and each lifecycle phase; disabled rules do not apply',()=>{
 const f=fixture();try{
  const r=f.rules.set(input());
  assert.throws(()=>f.repo.update('refs/tags/v1',null,{commit:sha('a'),tree:''},false,'owner'),/creation is restricted/);
  f.repo.update('refs/tags/v0-test',null,{commit:sha('a'),tree:''},false,'owner');
  f.rules.set(input({rules:[{type:'update'},{type:'deletion'}]}),r.id);
  f.repo.update('refs/tags/v1',null,{commit:sha('a'),tree:''},false,'owner');
  assert.throws(()=>f.repo.update('refs/tags/v1',sha('a'),{commit:sha('b'),tree:''},false,'owner'),/updates are restricted/);
  assert.throws(()=>f.repo.update('refs/tags/v1',sha('a'),null,false,'owner'),/deletion is restricted/);
  f.rules.set(input({enforcement:'disabled'}),r.id);
  f.repo.update('refs/tags/v1',sha('a'),{commit:sha('b'),tree:''},false,'owner');
  f.repo.update('refs/tags/v1',sha('b'),null,false,'owner');
 }finally{f.db.close();}
});
test('bypass is explicit, human-only, scoped to its ruleset, and audited',()=>{
 const f=fixture();try{
  const body=input({bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}]});
  const r=f.rules.set(body);
  assert.throws(()=>f.repo.update('refs/tags/v1',null,{commit:sha('a'),tree:''},false,'owner'),/creation/,'owner agent cannot inherit bypass');
  f.repo.update('refs/tags/v1',null,{commit:sha('a'),tree:''},false,'owner',false,undefined,true);
  const audit=JSON.parse(f.sql.exec('SELECT data FROM repository_audit ORDER BY id DESC LIMIT 1').toArray()[0].data);
  assert.deepEqual(audit.bypassedRulesets,[r.id]);assert.equal(audit.human,true);
  f.rules.set(input({name:'Another rule'}));
  assert.throws(()=>f.repo.update('refs/tags/v2',null,{commit:sha('a'),tree:''},false,'owner',false,undefined,true),/Another rule/);
 }finally{f.db.close();}
});
test('PR-only bypass permits merges but never agents or classic-policy bypass',()=>{
 const f=fixture();try{
  const r=input({target:'branch',conditions:{ref_name:{include:['~DEFAULT_BRANCH'],exclude:[]}},rules:[{type:'update'}],bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'pull_request'}]});
  f.rules.set(r);
  assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'owner',false,undefined,true),/updates/);
  assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'owner',true),/updates/);
  new Policies(f.sql).set({branch:'main',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:false,preventDelete:true,locked:true});
  assert.throws(()=>f.repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'owner',true,undefined,true),/locked/);
  new Policies(f.sql).remove('main');
  f.repo.update('refs/heads/main',sha('a'),{commit:sha('b'),tree:sha('2')},true,'owner',true,undefined,true);
 }finally{f.db.close();}
});
function graph(){
 const objects=new Map();
 const put=(type,body)=>{const o=encode(type,typeof body==='string'?new TextEncoder().encode(body):body);objects.set(o.sha,{type,body:o.raw.subarray(o.raw.indexOf(0)+1)});return o.sha;};
 const blob=s=>put('blob',typeof s==='number'?new Uint8Array(s):s);
 const makeTree=files=>{
  const entries=[],dirs=new Map();
  for(const [path,sha] of Object.entries(files)){
   const slash=path.indexOf('/');
   if(slash<0)entries.push({name:path,sha,mode:'100644'});
   else{const dir=path.slice(0,slash);if(!dirs.has(dir))dirs.set(dir,{});dirs.get(dir)[path.slice(slash+1)]=sha;}
  }
  for(const [name,children] of dirs)entries.push({name,sha:makeTree(children),mode:'40000'});
  const o=tree(entries);objects.set(o.sha,{type:'tree',body:o.raw.subarray(o.raw.indexOf(0)+1)});return o.sha;
 };
 const commit=(files,parents=[])=>put('commit',`tree ${makeTree(files)}\n${parents.map(p=>`parent ${p}\n`).join('')}author Fixture <f@example.invalid> 1 +0000\ncommitter Fixture <f@example.invalid> 1 +0000\n\nchange\n`);
 const tag=target=>put('tag',`object ${target}\ntype ${objects.get(target).type}\ntag release\ntagger Fixture <f@example.invalid> 1 +0000\n\nrelease\n`);
 return{objects,get:async sha=>objects.get(sha)??null,blob,commit,tag,makeTree};
}
test('push rules reject an intermediate prohibited file even when it is absent at the tip',async()=>{
 const f=fixture(),g=graph();try{
  const a=g.commit({}),b=g.commit({'private.key':g.blob('secret fixture')},[a]),c=g.commit({},[b]);
  f.rules.set(push([{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.key']}}]));
  const p=await repositoryProof(g.get,a,c,f.rules.plan());
  assert.match(p.rules.violations[0].message,/private.key/);
  assert.throws(()=>f.repo.update('refs/heads/topic',null,{commit:c,tree:''},false,'owner',false,p),/evidence is missing/,'proof old is bound');
  const create=await repositoryProof(g.get,null,c,f.rules.plan());
  assert.throws(()=>f.repo.update('refs/heads/topic',null,{commit:c,tree:''},false,'owner',false,create),/restricted file extension/);
 }finally{f.db.close();}
});
test('push proofs cover binary size, path restrictions and character length with annotated tag peeling',async()=>{
 const f=fixture(),g=graph();try{
  f.rules.set(push([{type:'max_file_size',parameters:{max_file_size:1}}]));
  const huge=g.commit({'image.bin':g.blob(1024*1024+1)}),tag=g.tag(g.tag(huge));
  const proof=await repositoryProof(g.get,null,tag,f.rules.plan());
  assert.match(proof.rules.violations[0].message,/exceeds 1 MiB/);
  f.rules.set(push([{type:'file_path_restriction',parameters:{restricted_file_paths:['secret[0-9].txt']}}]),1);
  const bad=g.commit({'secret1.txt':g.blob('x')});
  assert.match((await repositoryProof(g.get,null,bad,f.rules.plan())).rules.violations[0].message,/restricted file path/);
  f.rules.set(push([{type:'max_file_path_length',parameters:{max_file_path_length:5}}]),1);
  const unicode=g.commit({'日本語.md':g.blob('x')});
  assert.match((await repositoryProof(g.get,null,unicode,f.rules.plan())).rules.violations[0].message,/exceeds 5 characters/);
 }finally{f.db.close();}
});
test('rule changes invalidate clean graph evidence and stale/forged graph proofs fail closed',async()=>{
 const f=fixture(),g=graph();try{
  const c=g.commit({'ok.txt':g.blob('ok')});
  f.rules.set(push([{type:'max_file_size',parameters:{max_file_size:1}}]));
  const proof=await repositoryProof(g.get,null,c,f.rules.plan());assert.deepEqual(proof.rules.violations,[]);
  f.rules.set(push([{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.txt']}}]),1);
  assert.throws(()=>f.repo.update('refs/heads/topic',null,{commit:c,tree:''},false,'owner',false,proof),/rules changed/);
  const current=await repositoryProof(g.get,null,c,f.rules.plan());
  assert.throws(()=>f.repo.update('refs/tags/topic',null,{commit:c,tree:''},false,'owner',false,current),/extension/);
  assert.throws(()=>f.repo.update('refs/heads/topic',null,{commit:c,tree:''},false,'owner',false,{old:null,next:c,linear:true}),/evidence is missing/);
 }finally{f.db.close();}
});
test('path checks inspect merge side parents and tags to tree/blob; existing ancestry is grandfathered on updates',async()=>{
 const f=fixture(),g=graph();try{
  const a=g.commit({}),side=g.commit({'bad.exe':g.blob('bad')},[a]),main=g.commit({'ok.txt':g.blob('ok')},[a]),merge=g.commit({'ok.txt':g.blob('ok')},[main,side]);
  f.rules.set(push([{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.exe']}}]));
  assert.match((await repositoryProof(g.get,main,merge,f.rules.plan())).rules.violations[0].message,/bad.exe/);
  const treeTag=g.tag(g.makeTree({'bad.exe':g.blob('x')}));
  assert.match((await repositoryProof(g.get,null,treeTag,f.rules.plan())).rules.violations[0].message,/bad.exe/);
  assert.match((await repositoryProof(g.get,null,g.tag(g.blob('x')),f.rules.plan())).rules.violations[0].message,/directly to a blob/);
  const later=g.commit({'bad.exe':g.blob('bad'),'ok.txt':g.blob('new')},[side]);
  assert.deepEqual((await repositoryProof(g.get,side,later,f.rules.plan())).rules.violations,[]);
 }finally{f.db.close();}
});
test('glob evaluation supports slash-aware stars, zero-directory **/ and character ranges; unknown fields reject',()=>{
 for(const [pattern,path,expected] of [['**/*.key','a.key',true],['**/*.key','a/b.key',true],['release/*','release/a/b',false],['release/**','release/a/b',true],['v[0-9]?','v12',true],['v[0-9]?','va2',false]])assert.equal(matchesGlob(pattern,path),expected);
 assert.throws(()=>matchesGlob('[^a]','b'),/Unsupported/);
 assert.equal(matchesGlob('🔒/*.key','🔒/a.key'),true);
 assert.equal(matchesGlob('?.key','🔒.key'),true);
 assert.throws(()=>validateRuleset(input({bypass_actors:[{actor_type:'RepositoryRole',actor_id:2,bypass_mode:'always'}]})),/Bypass/);
 assert.throws(()=>validateRuleset(push([{type:'max_file_size',parameters:{max_file_size:1,unknown_parameter:['a']}}])),/Unsupported/);
 assert.throws(()=>validateRuleset(input({enforcement:'unsupported'})),/Invalid/);
});

test('path and size exceptions permit a specific nested binary without allowing neighboring files',async()=>{
 const f=fixture(),g=graph();try{
  const allowed=['**/gradle/wrapper/*.jar'];
  f.rules.set(push([{type:'file_path_restriction',parameters:{restricted_file_paths:['**/*.jar'],allowed_file_paths:allowed}},{type:'max_file_size',parameters:{max_file_size:1,allowed_file_paths:allowed}}]));
  const large=g.blob(1024*1024+1),good=g.commit({'project/gradle/wrapper/gradle-wrapper.jar':large});
  const proof=await repositoryProof(g.get,null,good,f.rules.plan());assert.deepEqual(proof.rules.violations,[]);
  f.repo.update('refs/heads/exceptions',null,{commit:good,tree:''},false,'writer',false,proof);
  const bad=g.commit({'project/gradle/wrapper/gradle-wrapper.jar':large,'project/other.jar':g.blob('small')},[good]);
  assert.match((await repositoryProof(g.get,good,bad,f.rules.plan())).rules.violations[0].message,/restricted file path: project\/other.jar/);
 }finally{f.db.close();}
});
test('an exception waives only its own rule and never another ruleset',async()=>{
 const f=fixture(),g=graph();try{
  const a={type:'file_path_restriction',parameters:{restricted_file_paths:['**/*.jar'],allowed_file_paths:['**/wrapper/*.jar']}};
  const large=g.commit({'wrapper/allowed.jar':g.blob(1024*1024+1)});
  f.rules.set(push([a,{type:'max_file_size',parameters:{max_file_size:1}}]));
  assert.match((await repositoryProof(g.get,null,large,f.rules.plan())).rules.violations[0].message,/exceeds 1 MiB/);
  f.rules.set(push([a,{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.jar']}}]),1);
  assert.match((await repositoryProof(g.get,null,large,f.rules.plan())).rules.violations[0].message,/restricted file extension/);
  f.rules.set(push([a]),1);
  const second=f.rules.set(push([{type:'file_path_restriction',parameters:{restricted_file_paths:['**/*.jar']}}]));
  const p=await repositoryProof(g.get,null,large,f.rules.plan());
  assert.deepEqual(p.rules.violations.map(v=>v.rulesetId),[second.id]);
  assert.throws(()=>f.repo.update('refs/tags/blocked',null,{commit:large,tree:''},false,'writer',false,p),/restricted file path/);
 }finally{f.db.close();}
});
test('exception edits invalidate proofs; intermediate denied paths and raw blob tags remain blocked',async()=>{
 const f=fixture(),g=graph();try{
  const exception=push([{type:'file_path_restriction',parameters:{restricted_file_paths:['**/*.jar'],allowed_file_paths:['wrapper/*.jar']}}]);
  f.rules.set(exception);
  const allowed=g.commit({'wrapper/allowed.jar':g.blob('fixture')}),p=await repositoryProof(g.get,null,allowed,f.rules.plan());
  f.rules.set(push([{type:'file_path_restriction',parameters:{restricted_file_paths:['**/*.jar'],allowed_file_paths:[]}}]),1);
  assert.throws(()=>f.repo.update('refs/heads/new',null,{commit:allowed,tree:''},false,'writer',false,p),/rules changed/);
  assert.match((await repositoryProof(g.get,null,allowed,f.rules.plan())).rules.violations[0].message,/restricted file path/);
  f.rules.set(exception,1);
  const denied=g.commit({'other/blocked.jar':g.blob('fixture')}),renamed=g.commit({'wrapper/allowed.jar':g.blob('fixture')},[denied]);
  assert.match((await repositoryProof(g.get,null,renamed,f.rules.plan())).rules.violations[0].message,/other\/blocked.jar/);
  f.rules.set(push([{type:'max_file_size',parameters:{max_file_size:1,allowed_file_paths:['**']}}]),1);
  assert.match((await repositoryProof(g.get,null,g.tag(g.blob(1024*1024+1)),f.rules.plan())).rules.violations[0].message,/exceeds 1 MiB/,'a blob cannot assert an allowed filename');
 }finally{f.db.close();}
});
test('exception validation rejects unsupported rules, malformed arrays, syntax and excessive patterns',()=>{
 const make=allowed_file_paths=>push([{type:'file_path_restriction',parameters:{restricted_file_paths:['**/*.jar'],allowed_file_paths}}]);
 assert.deepEqual(validateRuleset(make(['wrapper/*.jar','wrapper/*.jar'])).rules[0].parameters.allowed_file_paths,['wrapper/*.jar']);
 for(const invalid of [null,'wrapper/*.jar',['[broken'],['x'.repeat(201)],Array(201).fill('a')])assert.throws(()=>validateRuleset(make(invalid)),/Invalid|Unsupported/);
 assert.throws(()=>validateRuleset(push([{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.jar'],allowed_file_paths:['wrapper/*.jar']}}])),/Unsupported/);
 assert.throws(()=>validateRuleset(push([{type:'max_file_path_length',parameters:{max_file_path_length:255,allowed_file_paths:['**']}}])),/Unsupported/);
});

test('activity keyset pagination reads the whole audit without duplicates when new events arrive',()=>{
 const f=fixture();try{
  for(let i=0;i<260;i++)f.repo.audit({actor:'writer',ref:`refs/heads/topic-${i}`,old:null,next:sha('b')});
  const expected=f.repo.activity({limit:100}).events[0].id;
  let page=f.repo.activity({limit:25});const ids=page.events.map(e=>e.id);
  assert.equal(ids[0],expected);assert.ok(page.nextCursor);
  f.repo.audit({actor:'new-writer',ref:'refs/heads/arrived-later',old:null,next:sha('c')});
  while(page.nextCursor){page=f.repo.activity({limit:25,before:page.nextCursor});ids.push(...page.events.map(e=>e.id));}
  assert.equal(ids.length,261);assert.equal(new Set(ids).size,261);
  assert.deepEqual(ids,Array.from({length:261},(_,i)=>expected-i));
  assert.equal(f.repo.activity({ref:'refs/heads/arrived-later'}).events.length,1);
  assert.equal(f.repo.activity({before:1}).nextCursor,null);
 }finally{f.db.close();}
});
test('activity filters preserve deleted ruleset history and restrict payloads to recorded public audit fields',()=>{
 const f=fixture();try{
  const r=f.rules.set(input());
  f.repo.audit({actor:'admin',ruleset:r,previousRuleset:null,internalCredential:'synthetic-private-value'});
  f.repo.audit({actor:'human',ref:'refs/tags/v1',old:null,next:sha('a'),human:true,bypassedRulesets:[r.id]});
  f.repo.audit({actor:'admin',removedRuleset:r.id,previousRuleset:r});
  f.repo.audit({actor:'admin',policy:{branch:'main'}});
  f.repo.audit({actor:'owner',retry:'candidate'});
  assert.equal(f.repo.activity({ruleset:r.id}).events.length,3);
  assert.equal(f.repo.activity({ruleset:r.id,kind:'rulesets'}).events.length,2);
  assert.deepEqual(f.repo.activity({kind:'bypasses'}).events[0].bypassedRulesets,[r.id]);
  assert.equal(f.repo.activity({ruleset:r.id,ref:'refs/heads/main'}).events.length,0);
  assert.equal(f.repo.activity({kind:'protections'}).events.length,1);
  assert.equal(f.repo.activity({kind:'ci'}).events.length,1);
  const history=f.repo.activity({ruleset:r.id,kind:'rulesets'}).events;
  assert.equal(history[0].previousRuleset.name,r.name);
  assert.ok(!JSON.stringify(history).includes('synthetic-private-value'));
 }finally{f.db.close();}
});
test('activity rejects unbounded pagination and malformed filters instead of interpolating SQL',()=>{
 const f=fixture();try{
  for(const query of [{limit:0},{limit:101},{before:-1},{before:1.1},{before:Number.MAX_SAFE_INTEGER+1},{ruleset:0},{kind:'unknown'},{ref:"refs/heads/a' OR 1=1 --"}])
    assert.throws(()=>f.repo.activity(query),/Invalid/);
  assert.equal(f.repo.activity({ruleset:9999}).events.length,0);
 }finally{f.db.close();}
});

test('rewinds and divergent descendants cannot restore restricted files from previously reachable history',async()=>{
 const f=fixture(),g=graph();try{
  const file=g.blob(1024*1024+1),a=g.commit({}),bad=g.commit({'old/private.key':file},[a]),clean=g.commit({},[bad]),reused=g.commit({'old/private.key':file},[bad]);
  f.repo.update('refs/heads/rewind',null,{commit:clean,tree:g.makeTree({})},true,'owner');new Policies(f.sql).set({branch:'rewind',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,allowForcePush:['owner']});
  let id;for(const rule of[{type:'file_path_restriction',parameters:{restricted_file_paths:['old/**']}},{type:'file_extension_restriction',parameters:{restricted_file_extensions:['.key']}},{type:'max_file_path_length',parameters:{max_file_path_length:5}},{type:'max_file_size',parameters:{max_file_size:1}}]){
   id=f.rules.set(push([rule]),id).id;
   const safe=g.commit({'x':g.blob('safe')},[clean]),current=await repositoryProof(g.get,clean,safe,f.rules.plan(),'refs/heads/rewind');
   assert.equal(current.rules.fileTransitions,true);assert.throws(()=>f.rules.enforce('refs/heads/rewind',clean,safe,true,'owner',false,false,{...current,rules:{...current.rules,fileTransitions:undefined}}),/graph evidence/);assert.doesNotThrow(()=>f.rules.enforce('refs/heads/rewind',clean,safe,true,'owner',false,false,current));
   for(const next of[bad,reused]){const p=await repositoryProof(g.get,clean,next,f.rules.plan(),'refs/heads/rewind');assert.equal(p.rules.violations.length,1,rule.type);assert.throws(()=>f.repo.update('refs/heads/rewind',clean,{commit:next,tree:g.makeTree({'old/private.key':file})},false,'owner',false,p),/ruleset/);
    const tagged=await repositoryProof(g.get,g.tag(clean),g.tag(g.tag(next)),f.rules.plan(),'refs/tags/rewind');assert.equal(tagged.rules.violations.length,1,'Annotated-tag replacement checks the peeled tree transition');}
   f.rules.set({...push([rule]),enforcement:'evaluate'},id);const observation=await repositoryProof(g.get,clean,bad,f.rules.plan(),'refs/heads/rewind');assert.deepEqual(observation.rules.violations,[]);assert.equal(observation.evaluation.rules.violations.length,1);
  }
 }finally{f.db.close();}
});
