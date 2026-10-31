import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const output=await build({entryPoints:['review/store','repository/store','repository/policy','review/shared-head','review/feedback','review/pending','review/requests','review/feedback-http','review/feedback-access'].map(name=>new URL(`../src/${name}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{ReviewStore},{Repository},{Policies},{sharedHeadReviewBlockers},{reviewDecision,isHumanReview},{PendingReviews,humanPendingReviews},{RequestedReviews},{feedbackRequest,feedbackError},{reviewDecisionAllowed,assertReviewAccess}]=await Promise.all(output.outputFiles.map(file=>import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))));
const sha=c=>c.repeat(40),author={id:'author',name:'Author'},policy={branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,dismissStaleReviews:false};
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return {toArray:()=>rows};}};
 sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');
 for(const name of ['topic','peer'])repo.update('refs/heads/'+name,null,{commit:sha('b'),tree:sha('2')},true,'author');
 const store=new ReviewStore(sql,()=>repo.main(),true),run=c=>store.run(c,()=>{throw Error('Unexpected landing');}),branch=n=>store.branches().find(b=>b.name===n);
 for(const name of ['topic','peer'])run({op:'open',title:name,body:'',head:branch(name),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author});new Policies(sql).set(policy);
 const review=(id,verdict,feedback=false,pull=1)=>run({op:'review',number:pull,author:{id,name:id},body:'Feedback',commit:sha('b'),anchor:sha('a'),verdict:feedback?'COMMENT':verdict,independent:!feedback,...(feedback?{feedback:{role:'reader',verdict}}:{})});
 const gate=()=>{const s=store.snapshot();return new Policies(sql,{accounts:{reader:'writer',reviewer:'writer'},checkedAt:Date.now(),expiresAt:Date.now()+30000}).reviewGate(s.pulls.find(p=>p.number===1),s.reviews,sha('b'));};
 return {db,sql,repo,branch,store,run,review,gate};
}
test('reader opinions retain their decision while the legacy representation stays non-authoritative after promotion',()=>{
 const f=fixture();try{for(const decision of ['COMMENT','APPROVE','REQUEST_CHANGES'])f.review('reader',decision,true);const reviews=f.store.snapshot().reviews;
 assert.deepEqual(reviews.map(reviewDecision),['COMMENT','APPROVE','REQUEST_CHANGES']);assert.ok(reviews.every(r=>r.verdict==='COMMENT'&&r.independent===false&&isHumanReview(r)));assert.equal(f.gate().approvals,0);assert.equal(f.gate().ready,false);
 const raw=f.sql.exec('SELECT data FROM review_reviews').toArray().map(r=>JSON.parse(r.data));assert.ok(raw.every(r=>r.verdict==='COMMENT'&&r.independent===false));
 }finally{f.db.close();}
});
test('reader feedback cannot replace a historical writer change request or revoke an eligible approval',()=>{
 const f=fixture();try{f.review('reader','REQUEST_CHANGES');f.review('reader','APPROVE',true);f.review('reviewer','APPROVE');assert.match(f.gate().error,/requested changes/);
 f.review('reader','APPROVE');assert.equal(f.gate().ready,true);f.review('reader','REQUEST_CHANGES',true);assert.equal(f.gate().ready,true);assert.equal(f.gate().approvals,2);
 }finally{f.db.close();}
});
test('a reader decision cannot create or clear a same-head review veto in legacy gate readers',()=>{
 const f=fixture();try{f.review('reader','REQUEST_CHANGES',true,2);let s=f.store.snapshot();assert.deepEqual(sharedHeadReviewBlockers(f.sql,s.pulls.find(p=>p.number===1),sha('b'),s),[]);
 f.review('reader','REQUEST_CHANGES',false,2);f.review('reader','APPROVE',true,2);s=f.store.snapshot();assert.equal(sharedHeadReviewBlockers(f.sql,s.pulls.find(p=>p.number===1),sha('b'),s)[0].changesRequested,true);
 }finally{f.db.close();}
});
test('storage rejects opinion records that claim independent approval authority',()=>{
 const f=fixture();try{for(const extra of [{independent:true},{verdict:'APPROVE'},{feedback:{role:'writer',verdict:'APPROVE'}},{feedback:{role:'reader',verdict:'DISMISS'}},{feedback:null}]){
 const row={pull:1,author:{id:'reader',name:'Reader'},body:'Invalid authority',verdict:'COMMENT',independent:false,commit:sha('b'),anchor:sha('a'),feedback:{role:'reader',verdict:'APPROVE'},...extra};assert.throws(()=>f.sql.exec('INSERT INTO review_reviews(pull,data) VALUES(?,?)',1,JSON.stringify(row)),/cannot acquire review authority/);
 }assert.equal(f.store.snapshot().reviews.length,0);
 }finally{f.db.close();}
});
test('old SQL updates cannot strip the opinion marker, change its author or turn it into an approval',()=>{
 const f=fixture();try{f.review('reader','APPROVE',true);const original=f.sql.exec('SELECT data FROM review_reviews WHERE id=1').toArray()[0].data;
 for(const expression of ["json_remove(data,'$.feedback')","json_set(data,'$.independent',json('true'))","json_set(data,'$.verdict','APPROVE')","json_set(data,'$.feedback.verdict','REQUEST_CHANGES')","json_set(data,'$.author.id','reviewer')","json_set(data,'$.commit','other')"]){assert.throws(()=>f.sql.exec(`UPDATE review_reviews SET data=${expression} WHERE id=1`),/feedback|authority/);assert.equal(f.sql.exec('SELECT data FROM review_reviews WHERE id=1').toArray()[0].data,original);}
 }finally{f.db.close();}
});
test('writer dismissal preserves a reader opinion and its legacy authority fence',()=>{
 const f=fixture();try{f.review('reader','REQUEST_CHANGES',true);f.run({op:'dismiss',number:1,reviewId:1,actor:{id:'reviewer',name:'Reviewer'},reason:'Close optional feedback',human:true,origin:'https://fixture.invalid'});const r=f.store.snapshot().reviews[0];assert.equal(r.verdict,'COMMENT');assert.equal(r.independent,false);assert.equal(reviewDecision(r),'REQUEST_CHANGES');assert.equal(r.dismissed.actor.id,'reviewer');
 }finally{f.db.close();}
});

const reader={id:'reader',origin:'https://fixture.invalid'};
const pendingFixture=()=>{
 const f=fixture(),pull=n=>f.store.snapshot().pulls.find(p=>p.number===n),head=n=>f.branch(pull(n).head);
 const select=(actor=reader,writer=false,n=2,id)=>humanPendingReviews(f.sql,n,actor,writer,id);
 const add=(actor=reader,writer=false,n=2,id='reader-private-review')=>select(actor,writer,n).run({op:'add',number:n,actor,author:{id:actor.id,name:actor.id},reviewId:id,revision:0,commit:head(n).commit,anchor:pull(n).anchor,comment:{id:id+'-comment',pull:n,author:{id:actor.id,name:actor.id},commit:head(n).commit,anchor:pull(n).anchor,path:'code.ts',side:'RIGHT',startLine:1,line:1,body:'Private feedback',at:1,excerpt:'Code',replyTo:null,resolved:false,...(actor.via?{via:actor.via}:{})}},pull(n),head(n));
 return {...f,pull,head,select,add};
};
test('reader private drafts stay outside legacy same-head gates, including after promotion',()=>{
 const f=pendingFixture();try{
  f.add();assert.equal(f.sql.exec('SELECT * FROM review_drafts').toArray().length,0);assert.equal(f.sql.exec('SELECT * FROM review_feedback_drafts').toArray().length,1);
  assert.equal(f.select(reader,true).run({op:'get',number:2,actor:reader},f.pull(2),f.head(2)).pending.id,'reader-private-review');
  assert.deepEqual(sharedHeadReviewBlockers(f.sql,f.pull(1),sha('b'),f.store.snapshot()),[]);
  assert.throws(()=>new PendingReviews(f.sql).run({op:'add',number:2,actor:reader,author:{id:reader.id,name:'Reader'},reviewId:'legacy-shadow-review',revision:0,commit:sha('b'),anchor:sha('a'),comment:{id:'legacy-shadow-comment',pull:2,author:{id:reader.id,name:'Reader'},commit:sha('b'),anchor:sha('a'),path:'code.ts',side:'RIGHT',startLine:1,line:1,body:'Shadow',at:1,excerpt:'Code',replyTo:null,resolved:false}},f.pull(2),f.head(2)),/already exists/);
 }finally{f.db.close();}
});
test('demotion does not silently erase a historical writer pending-review veto',()=>{
 const f=pendingFixture();try{f.add(reader,true);assert.equal(f.select(reader,false).run({op:'get',number:2,actor:reader},f.pull(2),f.head(2)).pending.id,'reader-private-review');assert.equal(sharedHeadReviewBlockers(f.sql,f.pull(1),sha('b'),f.store.snapshot())[0].pendingReview,true);
 f.select(reader,false).run({op:'discard',number:2,actor:reader,reviewId:'reader-private-review',revision:1},f.pull(2),f.head(2));assert.deepEqual(sharedHeadReviewBlockers(f.sql,f.pull(1),sha('b'),f.store.snapshot()),[]);
 assert.equal(f.select(reader,false,2,'reader-private-review').ownsReceipt('reader-private-review',2,reader),true);assert.throws(()=>f.add(reader,false),/already used/);
 }finally{f.db.close();}
});
test('reader browser and delegated private workspaces stay isolated across roles and cannot reuse another store identity',()=>{
 const f=pendingFixture();try{
  f.add();const cli={...reader,via:{kind:'cli',credentialId:'11111111-1111-4111-8111-111111111111'}},sibling={...reader,via:{kind:'cli',credentialId:'22222222-2222-4222-8222-222222222222'}};
  for(const actor of [cli,sibling,{...reader,id:'other'}])assert.equal(f.select(actor).run({op:'get',number:2,actor},f.pull(2),f.head(2)).pending,null);
  f.add(cli,true,2,'cli-writer-review');assert.equal(f.select(cli,false).run({op:'get',number:2,actor:cli},f.pull(2),f.head(2)).pending.id,'cli-writer-review');
  assert.throws(()=>f.add({...reader,id:'other'},true,2,'reader-private-review'),/already used/);
 }finally{f.db.close();}
});
test('the repository-wide pending limit covers both trust classes and permits updates at capacity',()=>{
 const f=pendingFixture();try{f.add();for(let i=0;i<999;i++)f.sql.exec('INSERT INTO review_drafts VALUES(?,?,?,?)','seed-'+i,100+i,'seed-'+i,'{}');assert.throws(()=>f.add({...reader,id:'other'},true,1,'one-too-many-review'),/pending review limit/);
 const result=f.select().run({op:'edit',number:2,actor:reader,reviewId:'reader-private-review',revision:1,commentId:'reader-private-review-comment',body:'Updated at capacity'},f.pull(2),f.head(2));assert.equal(result.pending.revision,2);
 }finally{f.db.close();}
});
test('reader feedback answers a requested review without acquiring approval authority, even with backward clocks',()=>{
 const f=fixture();try{const requests=new RequestedReviews(f.sql),pull=f.store.snapshot().pulls.find(p=>p.number===1);
 requests.edit({number:1,actor:{id:'reviewer',name:'Writer'},operation:'request',reviewers:['reader'],revision:0,commit:sha('b'),anchor:sha('a')},pull,sha('b'));
 f.review('reader','APPROVE',true);const answered=requests.list(1);assert.equal(answered.readerFeedback,'v1');assert.equal(answered.requests[0].state,'reviewed');assert.equal(f.gate().approvals,0);
 const row=f.store.snapshot().reviews[0];assert.equal(answered.requests[0].reviewId,row.id);assert.equal(row.independent,false);
 }finally{f.db.close();}
});
test('human review decisions reject author self-approval and empty comments; inline comments supply review content',()=>{
 const p={author:{id:'author'}};for(const verdict of ['APPROVE','REQUEST_CHANGES'])assert.throws(()=>reviewDecisionAllowed(p,'author',verdict,'Own feedback'),/authors can comment/);
 assert.throws(()=>reviewDecisionAllowed(p,'reader','COMMENT','  '),/Write feedback/);assert.doesNotThrow(()=>reviewDecisionAllowed(p,'reader','COMMENT','',1));assert.doesNotThrow(()=>reviewDecisionAllowed(p,'author','COMMENT','Explanation'));
 for(const access of [{checkedAt:0,expiresAt:100},{checkedAt:1001,expiresAt:2000},{checkedAt:100,expiresAt:1000},{checkedAt:NaN,expiresAt:Infinity}])assert.throws(()=>assertReviewAccess({...access,role:'reader'},1000),/expired/);
 assert.doesNotThrow(()=>assertReviewAccess({role:'reader',checkedAt:999,expiresAt:1001},1000));
});
test('reader HTTP exceptions only admit exact feedback operations and missing RPCs fail closed',()=>{
 for(const [method,op,tail]of [['POST','reviews',[]],['POST','comments',[]],['PATCH','comments',[]],['GET','pending-review',[]],['DELETE','pending-review',[]],['POST','pending-review',['submit']]])assert.equal(feedbackRequest(method,'pulls','1',op,tail),true);
 for(const [method,action,id,op,tail]of [['POST','pulls','1','merge',[]],['POST','pulls','1','suggestions',[]],['POST','pulls','1','reviews',['dismissals']],['POST','pulls','01','reviews',[]],['POST','pulls','0','reviews',[]],['POST','pulls','1','pending-review',['submit','extra']],['POST','branches','1','reviews',[]],['DELETE','pulls','1','comments',[]],['POST','pulls','1000000000','reviews',[]]])assert.equal(feedbackRequest(method,action,id,op,tail),false);
 for(const method of ['submitHumanReview','pendingReviewWithFeedback','submitPendingReviewWithFeedback','pullCommentsWithFeedback','reviewFeedbackAccess','editRequestedReviewsWithFeedback']){const response=feedbackError(new Error('The RPC receiver does not implement the method "'+method+'".'));assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');}
});
test('upgrading an old v2 answer hook reconciles only a later reader opinion and preserves the revision fence',()=>{
 const f=fixture();try{const requests=new RequestedReviews(f.sql),pull=f.store.snapshot().pulls.find(p=>p.number===1);
 const edit=revision=>requests.edit({number:1,actor:{id:'reviewer',name:'Writer'},operation:'request',reviewers:['reader'],revision,commit:sha('b'),anchor:sha('a')},pull,sha('b'));
 f.review('reader','APPROVE',true);edit(0);const observed=requests.list(1).revision;
 f.sql.exec('DROP TRIGGER review_request_answer_v2');f.sql.exec("CREATE TRIGGER review_request_answer_v2 AFTER INSERT ON review_reviews WHEN json_type(NEW.data,'$.independent')='true' BEGIN SELECT 1; END");
 f.sql.exec('INSERT INTO review_reviews(pull,data) VALUES(?,?)',1,JSON.stringify({pull:1,author:{id:'reader',name:'Reader'},body:'Old receiver insert',commit:sha('b'),anchor:sha('a'),verdict:'COMMENT',independent:false,feedback:{role:'reader',verdict:'REQUEST_CHANGES'},at:0}));assert.equal(requests.list(1).requests[0].state,'requested');
 const repaired=new RequestedReviews(f.sql).list(1);assert.equal(repaired.requests[0].state,'reviewed');assert.equal(repaired.requests[0].reviewId,2);assert.ok(repaired.revision>observed);assert.equal(edit(observed).conflict,true);assert.equal(f.gate().approvals,0);
 assert.equal(f.sql.exec("SELECT COUNT(*) AS n FROM repository_audit WHERE json_extract(data,'$.reviewRequest.operation')='answer'").toArray()[0].n,1);assert.deepEqual(new RequestedReviews(f.sql).list(1),repaired);
 }finally{f.db.close();}
});
test('failed reader answer audit rolls back publication and trigger-driven answer before retry',()=>{
 const f=fixture();try{const requests=new RequestedReviews(f.sql),pull=f.store.snapshot().pulls.find(p=>p.number===1);requests.edit({number:1,actor:{id:'reviewer',name:'Writer'},operation:'request',reviewers:['reader'],revision:0,commit:sha('b'),anchor:sha('a')},pull,sha('b'));const before=requests.list(1);
 f.sql.exec("CREATE TRIGGER reject_reader_answer BEFORE INSERT ON repository_audit WHEN json_extract(NEW.data,'$.reviewRequest.operation')='answer' BEGIN SELECT RAISE(ABORT,'synthetic reader answer failure'); END");
 f.db.exec('BEGIN');assert.throws(()=>f.review('reader','APPROVE',true),/synthetic reader answer/);f.db.exec('ROLLBACK');assert.deepEqual(requests.list(1),before);assert.equal(f.store.snapshot().reviews.length,0);f.sql.exec('DROP TRIGGER reject_reader_answer');f.review('reader','APPROVE',true);assert.equal(requests.list(1).requests[0].state,'reviewed');
 }finally{f.db.close();}
});
