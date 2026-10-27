import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const built=await build({stdin:{contents:`export * from './src/repository/rulesets';export * from './src/repository/rule-proof';export * from './src/repository/insights';export * from './src/repository/store';export * from './src/repository/policy';export * from './src/repository/ruleset-transfer';export {encode,tree} from './src/git';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});
const {Rulesets,Repository,Policies,RuleInsights,ruleTransaction,repositoryProof,importRuleset,exportRuleset,encode,tree}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const sha=c=>c.repeat(40);
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'owner');
 const tx=run=>{db.exec('BEGIN');try{const r=run();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}};
 const run=(action,source='git')=>ruleTransaction(sql,tx,source,observe=>action(new Repository(sql,observe)));
 return{db,sql,repo,run,rules:new Rulesets(sql),insights:new RuleInsights(sql)};
}
const config=(extra={})=>({name:'Candidate rules',target:'branch',enforcement:'evaluate',conditions:{ref_name:{include:['~ALL'],exclude:[]}},rules:[{type:'creation'}],...extra});
function graph(){const objects=new Map();const put=(type,body)=>{const o=encode(type,body);objects.set(o.sha,{type,body});return o.sha;};const blob=s=>put('blob',new TextEncoder().encode(s));const commit=(files,parents=[],message='subject')=>{const encoded=tree(Object.entries(files).map(([name,hash])=>({name,sha:hash,mode:'100644'})));const t=put('tree',encoded.raw.subarray(encoded.raw.indexOf(0)+1));return put('commit',new TextEncoder().encode(`tree ${t}\n${parents.map(p=>`parent ${p}\n`).join('')}author Fixture <author@fixture.invalid> 1700000000 +0000\ncommitter Fixture <author@fixture.invalid> 1700000000 +0000\n\n${message}\n`));};return{put,blob,commit,get:async sha=>objects.get(sha)??null};}

test('evaluate records failures without blocking; activating the same rule rejects with durable failed evidence',()=>{
 const f=fixture();try{
  const r=f.rules.set(config());
  f.run(repo=>repo.update('refs/heads/first',null,{commit:sha('b'),tree:sha('2')},false,'writer'));
  let page=f.insights.list();assert.equal(page.suites[0].accepted,true);assert.equal(page.suites[0].result,'fail');assert.equal(page.suites[0].evaluations[0].enforcement,'evaluate');
  f.rules.set({...config(),enforcement:'active'},r.id);
  const before=f.repo.activity({kind:'refs'}).events.length;
  assert.throws(()=>f.run(repo=>repo.update('refs/heads/second',null,{commit:sha('c'),tree:sha('3')},false,'writer')),/creation is restricted/);
  page=f.insights.list();assert.equal(page.suites[0].accepted,false);assert.match(page.suites[0].rejection,/creation is restricted/);assert.equal(f.repo.refs().some(r=>r.name.endsWith('/second')),false);assert.equal(f.repo.activity({kind:'refs'}).events.length,before);
  assert.equal(f.insights.get(page.suites[0].id).revision,2);assert.equal(f.insights.get(99999),null);
  f.rules.set(config({enforcement:'disabled'}),r.id);f.run(repo=>repo.update('refs/heads/disabled',null,{commit:sha('d'),tree:sha('4')},false,'writer'));assert.equal(f.insights.list().suites.length,2);
 }finally{f.db.close();}
});

test('atomic rejection rolls back refs and accepted-write audit but retains every attempted ref with one batch identity',()=>{
 const f=fixture();try{
  f.rules.set(config({enforcement:'active',conditions:{ref_name:{include:['refs/heads/blocked'],exclude:[]}}}));
  f.rules.set(config({name:'Observe all',rules:[]}));
  assert.throws(()=>f.run(repo=>{repo.update('refs/heads/first',null,{commit:sha('b'),tree:sha('2')},false,'owner');repo.update('refs/heads/blocked',null,{commit:sha('b'),tree:sha('2')},false,'owner');}),/creation is restricted/);
  assert.equal(f.repo.refs().length,1);assert.equal(f.repo.activity({kind:'refs'}).events.length,1);
  const suites=f.insights.list().suites;assert.equal(suites.length,2);assert.equal(new Set(suites.map(s=>s.batch)).size,1);assert.ok(suites.every(s=>!s.accepted));assert.equal(suites.find(s=>s.ref.endsWith('/first')).result,'pass');assert.equal(suites.find(s=>s.ref.endsWith('/blocked')).result,'fail');
 }finally{f.db.close();}
});

test('evaluation graph failures and signature outcomes cannot satisfy or weaken active evidence',async()=>{
 const f=fixture(),g=graph();try{
  const b=g.blob('fixture'),base=g.commit({'safe.txt':b}),next=g.commit({'blocked.txt':b},[base],'not conventional');
  const active=f.rules.set(config({name:'Active metadata',enforcement:'active',rules:[{type:'committer_email_pattern',parameters:{operator:'ends_with',pattern:'@fixture.invalid'}}]}));
  const observing=f.rules.set(config({name:'Observe paths',target:'push',conditions:undefined,rules:[{type:'file_path_restriction',parameters:{restricted_file_paths:['blocked.txt']}}]}));
  const sig=f.rules.set(config({name:'Observe signatures',rules:[{type:'required_signatures'}]}));
  const p=await repositoryProof(g.get,base,next,f.rules.plan(),'refs/heads/main',async()=>({verified:false,reason:'unsigned fixture'}));
  assert.deepEqual(p.rules.violations,[]);assert.equal(p.signatures,undefined);assert.equal(p.evaluation.rules.violations[0].rulesetId,observing.id);assert.equal(p.evaluation.signatures.verified,false);
  f.run(repo=>repo.update('refs/heads/copied',null,{commit:next,tree:sha('2')},true,'writer',false,{...p,old:null,rules:{...p.rules,ref:'refs/heads/copied'},evaluation:{...p.evaluation,rules:{...p.evaluation.rules,ref:'refs/heads/copied'}}}));
  const suite=f.insights.list().suites[0];assert.equal(suite.accepted,true);assert.equal(suite.evaluations.find(r=>r.id===active.id).result,'pass');assert.equal(suite.evaluations.find(r=>r.id===observing.id).result,'fail');assert.notEqual(suite.evaluations.find(r=>r.id===sig.id).result,'pass');
  f.rules.set({...config(),name:'Require signatures now',enforcement:'active',rules:[{type:'required_signatures'}]},sig.id);
  assert.throws(()=>f.run(repo=>repo.update('refs/heads/forged',null,{commit:next,tree:sha('2')},true,'writer',false,{...p,old:null,evaluation:{...p.evaluation,signatures:{verified:true,checked:1,reason:null}}})),/rules changed|signatures|another ref/);
  assert.equal(f.repo.refs().some(r=>r.name.endsWith('/forged')),false);
 }finally{f.db.close();}
});

test('observation-only resource failure is recorded as error and does not reject otherwise valid Git evidence',async()=>{
 const f=fixture(),g=graph();try{
  const b=g.blob('fixture'),c=g.commit({'large.txt':b});f.rules.set(config({target:'push',conditions:undefined,rules:[{type:'max_file_size',parameters:{max_file_size:1}}]}));
  const proof=await repositoryProof(async sha=>{if(sha===b)throw Error('Synthetic observation resource limit');return g.get(sha);},null,c,f.rules.plan(),'refs/heads/topic');
  assert.match(proof.evaluation.error,/resource limit/);assert.equal(proof.linear,true);
  f.run(repo=>repo.update('refs/heads/topic',null,{commit:c,tree:sha('2')},true,'writer',false,proof));
  const suite=f.insights.list().suites[0];assert.equal(suite.accepted,true);assert.equal(suite.result,'error');assert.match(suite.evaluations[0].reasons.join(' '),/resource limit/);
 }finally{f.db.close();}
});

test('human-only bypass, exclusions and classic protection intersection remain enforced and observable',()=>{
 const f=fixture();try{
  const r=f.rules.set(config({enforcement:'active',bypass_actors:[{actor_type:'User',actor_id:'owner',bypass_mode:'always'}],conditions:{ref_name:{include:['~ALL'],exclude:['refs/heads/excluded']}}}));
  f.run(repo=>repo.update('refs/heads/human',null,{commit:sha('b'),tree:sha('2')},true,'owner',false,undefined,true),'branch');
  assert.equal(f.insights.list().suites[0].result,'bypass');assert.deepEqual(f.repo.activity({kind:'bypasses'}).events[0].bypassedRulesets,[r.id]);
  assert.throws(()=>f.run(repo=>repo.update('refs/heads/agent',null,{commit:sha('b'),tree:sha('2')},true,'owner')),/creation/);
  new Policies(f.sql).set({branch:'locked',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true});
  assert.throws(()=>f.run(repo=>repo.update('refs/heads/locked',null,{commit:sha('b'),tree:sha('2')},true,'owner',false,undefined,true)),/locked/);
  assert.equal(f.insights.list().suites[0].accepted,false);assert.equal(f.insights.list().suites[0].result,'bypass');
  f.run(repo=>repo.update('refs/heads/excluded',null,{commit:sha('b'),tree:sha('2')},true,'writer'));assert.equal(f.insights.list().suites.length,3);
 }finally{f.db.close();}
});

test('insight pagination and filters survive new arrivals and reject SQL-shaped or unbounded input',()=>{
 const f=fixture();try{
  const r=f.rules.set(config({rules:[]}));for(let i=0;i<61;i++)f.run(repo=>repo.update(`refs/heads/topic-${i}`,null,{commit:sha('b'),tree:sha('2')},true,i%2?'alice':'bob'));
  let page=f.insights.list({limit:25});const ids=page.suites.map(s=>s.id);f.run(repo=>repo.update('refs/heads/new',null,{commit:sha('b'),tree:sha('2')},true,'alice'));
  while(page.nextCursor){page=f.insights.list({limit:25,before:page.nextCursor});ids.push(...page.suites.map(s=>s.id));}assert.equal(ids.length,61);assert.equal(new Set(ids).size,61);
  assert.equal(f.insights.list({actor:'bob',limit:100}).suites.length,31);assert.equal(f.insights.list({ref:'refs/heads/new',ruleset:r.id,result:'pass'}).suites.length,1);assert.equal(f.insights.list({from:Date.now()+10000}).suites.length,0);
  for(const query of [{limit:0},{limit:101},{before:0},{ruleset:1.2},{result:'unknown'},{from:4,to:2},{actor:'\n'},{ref:"refs/heads/a' OR 1=1 --"}])assert.throws(()=>f.insights.list(query),/Invalid/);
 }finally{f.db.close();}
});

test('retention prunes expired observations and bounds count and bytes without changing refs',()=>{
 const f=fixture();try{
  const attempt={ref:'refs/heads/topic',old:null,next:sha('b'),actor:'writer',human:false,merge:false,revision:1,evaluations:[{id:1,name:'Observe',enforcement:'evaluate',result:'pass',rules:[],reasons:[]}]};
  f.insights.record(Array(2005).fill(attempt),'git',true);assert.equal(f.sql.exec('SELECT COUNT(*) AS n FROM repository_rule_suites').toArray()[0].n,2000);
  f.sql.exec('UPDATE repository_rule_suites SET at=1');f.insights.record([attempt],'git',true);assert.equal(f.insights.list({limit:100}).suites.length,1);
  const large={...attempt,evaluations:Array.from({length:100},(_,id)=>({...attempt.evaluations[0],id,reasons:Array(20).fill('x'.repeat(512))}))};f.insights.record(Array(40).fill(large),'git',true);
  assert.ok(f.sql.exec('SELECT SUM(length(CAST(data AS BLOB))) AS n FROM repository_rule_suites').toArray()[0].n<=33554432);assert.equal(f.repo.refs().length,1);
 }finally{f.db.close();}
});

test('portable evaluate configurations retain their mode and restrictions on import/export',()=>{
 const rule=config({rules:[{type:'required_signatures'},{type:'deletion'}]});const imported=importRuleset(exportRuleset(rule));assert.equal(imported.configuration.enforcement,'evaluate');assert.deepEqual(imported.configuration.rules,rule.rules);
});
