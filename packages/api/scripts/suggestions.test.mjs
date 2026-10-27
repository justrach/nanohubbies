import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
const names=['review/suggestion-text','review/suggestion-graph','review/suggestion-store','review/store','repository/store','repository/policy','review/pull-comments','git'];
const out=await build({entryPoints:names.map(n=>new URL(`../src/${n}.ts`,import.meta.url).pathname),bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{suggestionText,suggestionFence,replaceSuggestion},{suggestionCommit},{SuggestionApplications},{ReviewStore},{Repository},{Policies},{PullComments},git]=await Promise.all(out.outputFiles.map(o=>import('data:text/javascript;base64,'+Buffer.from(o.text).toString('base64'))));
const sha=c=>c.repeat(40),actor={id:'writer',name:'Writer'},fence=code=>'```suggestion\n'+code+'\n```';
test('suggestion fences distinguish empty deletion, blank lines, nested code, incomplete and multiple blocks',()=>{
 assert.deepEqual(suggestionText('Before\n```suggestion\nx\ny\n```\nAfter'),{before:'Before',lines:['x','y'],after:'After'});
 assert.deepEqual(suggestionText('~~~suggestion\r\nx\r\n~~~').lines,['x']);assert.deepEqual(suggestionText('```suggestion\n```').lines,[]);assert.deepEqual(suggestionText('```suggestion\n\n```').lines,['']);
 for(const body of ['```suggestion\nx','```text\n~~~suggestion\nx\n~~~\n```',fence('x')+'\n'+fence('y'),'    ```suggestion\nx\n```','```suggestion:-1+2\nx\n```',fence('x\0y')])assert.equal(suggestionText(body),null);
 const content=['literal ``` inside code','~~~','é'];assert.deepEqual(suggestionText(suggestionFence(content)).lines,content);
});
test('line replacement preserves CRLF, UTF-8, EOF style and whole-line deletion without changing neighboring bytes',()=>{
 assert.equal(replaceSuggestion('α\r\nold\r\nlast',2,2,['new','more']),'α\r\nnew\r\nmore\r\nlast');
 assert.equal(replaceSuggestion('first\nlast',2,2,['new']),'first\nnew');assert.equal(replaceSuggestion('first\nlast\n',2,2,[]),'first\n');assert.equal(replaceSuggestion('a\nb\n',2,2,['']),'a\n\n');
 for(const [from,to] of [[0,1],[1,4],[2,1],[1,202]])assert.throws(()=>replaceSuggestion('a\nb\n',from,to,['x']),/range|no longer/);
 assert.throws(()=>replaceSuggestion('same\n',1,1,['same']),/does not change/);
});
function graph(){
 const objects=new Map(),put=o=>{objects.set(o.sha,{...o,...git.decode(o.raw)});return o.sha;},blob=s=>put(git.encode('blob',typeof s==='string'?new TextEncoder().encode(s):s));
 const tree=entries=>put(git.tree(entries)),entry=(name,mode,sha)=>({name,mode,sha}),identity={name:'Fixture',email:'fixture@example.invalid',time:1};
 const binary=blob(new Uint8Array([0,255,0,3])),link=blob('src/code.ts'),unchanged=blob('untouched é\n');
 const old=blob('one\noldA\nthree\noldB\nfive\n'),current=blob('one\nnewA\nthree\nnewB\nfive\n');
 const src=code=>tree([entry('code.ts','100644',code),entry('é.ts','100644',unchanged)]),root=(code,script)=>tree([entry('src','40000',src(code)),entry('run.sh','100755',blob(script)),entry('asset.bin','100644',binary),entry('link','120000',link)]);
 const baseTree=root(old,'echo OLD\r\n'),headTree=root(current,'echo NEW\r\n'),base=put(git.commit({tree:baseTree,parents:[],author:identity,committer:identity,message:'Base'})),head=put(git.commit({tree:headTree,parents:[base],author:identity,committer:identity,message:'Head'}));
 const pull={number:1,anchor:base,anchorTree:baseTree},branch={name:'feature',commit:head,tree:headTree};
 const comment=(id,path,startLine,line,code)=>({id,pull:1,path,side:'RIGHT',startLine,line,body:fence(code),commit:head,anchor:base,author:{id:'reviewer',name:'Reviewer'},at:1,replyTo:null,resolved:false,excerpt:''});
 return{objects,put,pull,branch,binary,link,unchanged,comment,reader:{async body(sha,type){const o=objects.get(sha);assert.equal(o.type,type);return o.body;}}};
}
test('batched suggestions preserve modes, symlinks, binary IDs and untouched subtrees while applying original coordinates',async()=>{
 const g=graph(),comments=[g.comment('suggest-1','src/code.ts',2,2,'A\nextra'),g.comment('suggest-2','src/code.ts',4,4,'B'),g.comment('suggest-3','run.sh',1,1,'echo FIXED')];
 const result=await suggestionCommit(g.reader,g.pull,g.branch,comments,actor,'Apply suggestions');result.objects.forEach(g.put);
 const commit=new TextDecoder().decode(g.objects.get(result.commit).body);assert.match(commit,new RegExp(`parent ${g.branch.commit}`));assert.equal((commit.match(/^parent /gm)??[]).length,1);assert.match(commit,/Co-authored-by: Reviewer/);
 const top=git.readTree(g.objects.get(result.tree).body),src=git.readTree(g.objects.get(top.find(e=>e.name==='src').sha).body),text=sha=>new TextDecoder().decode(g.objects.get(sha).body);
 assert.equal(text(src.find(e=>e.name==='code.ts').sha),'one\nA\nextra\nthree\nB\nfive\n');assert.equal(src.find(e=>e.name==='é.ts').sha,g.unchanged);assert.equal(top.find(e=>e.name==='asset.bin').sha,g.binary);assert.deepEqual(top.find(e=>e.name==='link'),{name:'link',mode:'120000',sha:g.link});assert.equal(top.find(e=>e.name==='run.sh').mode,'100755');assert.equal(text(top.find(e=>e.name==='run.sh').sha),'echo FIXED\r\n');
});
test('overlap, outdated/left/reply selections and unchanged code reject before a Git candidate is produced',async()=>{
 const g=graph(),good=g.comment('suggest-1','src/code.ts',2,3,'x');
 await assert.rejects(suggestionCommit(g.reader,g.pull,g.branch,[good,g.comment('suggest-2','src/code.ts',3,4,'y')],actor,'Apply'),/overlap/);
 for(const change of [{side:'LEFT'},{commit:sha('f')},{anchor:sha('e')},{replyTo:'other-thread'},{applied:{commit:sha('d')}},{line:200}])await assert.rejects(suggestionCommit(g.reader,g.pull,g.branch,[{...good,...change}],actor,'Apply'),/current after-side|visible diff/);
 await assert.rejects(suggestionCommit(g.reader,g.pull,g.branch,[g.comment('same-code','src/code.ts',2,2,'newA')],actor,'Apply'),/does not change/);
});
function fixture(){
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');
 const repo=new Repository(sql);repo.initialize();repo.update('refs/heads/main',null,{commit:sha('a'),tree:sha('1')},false,'author');repo.update('refs/heads/feature',null,{commit:sha('b'),tree:sha('2')},true,'author');
 new Policies(sql).set({branch:'main',pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true});
 const review=new ReviewStore(sql,()=>repo.main(),true),branch=name=>review.snapshot().branches.find(b=>b.name===name);review.run({op:'open',title:'Change',body:'',head:branch('feature'),base:branch('main'),anchor:sha('a'),anchorTree:sha('1'),author:{id:'author',name:'Author'}},()=>{});review.run({op:'review',number:1,author:{id:'reviewer',name:'Reviewer'},commit:sha('b'),anchor:sha('a'),body:'Approved',verdict:'APPROVE',independent:true},()=>{});
 const comments=[1,2].map(n=>({id:`suggestion-${n}`,pull:1,path:'code.ts',side:'RIGHT',startLine:n,line:n,body:fence(`new ${n}`),commit:sha('b'),anchor:sha('a'),author:{id:'reviewer',name:'Reviewer'},at:1,replyTo:null,resolved:false,excerpt:''})),store=new PullComments(sql);for(const comment of comments)store.run({op:'add',number:1,commit:sha('b'),anchor:sha('a'),actor:{id:'reviewer',origin:'http://localhost'},comment},review.snapshot().pulls[0],branch('feature'));
 const apps=new SuggestionApplications(sql),command={id:'application-test',number:1,commit:sha('b'),anchor:sha('a'),commentIds:comments.map(c=>c.id),message:'Apply suggestions',actor,origin:'http://localhost',comments,next:{commit:sha('c'),tree:sha('3')}};
 const apply=(c=command)=>{db.exec('BEGIN');try{const value=apps.run(c,()=>repo.main(),true);db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}};
 return{db,sql,repo,review,apps,command,apply,branch,roots:()=>sql.exec('SELECT data FROM pull_comments').toArray().map(r=>JSON.parse(r.data))};
}
test('branch update, stale dismissal, resolved roots and application receipt commit once and retry safely',()=>{
 const f=fixture();try{const receipt=f.apply();assert.equal(f.branch('feature').commit,sha('c'));assert.equal(f.repo.main().commit,sha('a'));assert.ok(f.roots().every(root=>root.resolved&&root.applied.commit===sha('c')));assert.equal(f.review.snapshot().reviews[0].dismissed.kind,'stale');const events=f.repo.activity({}).events.length;assert.equal(f.apply().commit,receipt.commit);assert.equal(f.repo.activity({}).events.length,events);assert.throws(()=>f.apply({...f.command,message:'Different'}),/already used/);}finally{f.db.close();}
});
test('late receipt failure rolls back the ref, audit, dismissal and thread resolutions together',()=>{
 const f=fixture();try{const events=f.repo.activity({}).events.length;f.sql.exec("CREATE TRIGGER fail_suggestion BEFORE INSERT ON review_suggestion_applications BEGIN SELECT RAISE(ABORT,'receipt rejected'); END");assert.throws(()=>f.apply(),/receipt rejected/);assert.equal(f.branch('feature').commit,sha('b'));assert.equal(f.repo.activity({}).events.length,events);assert.equal(f.review.snapshot().reviews[0].dismissed,undefined);assert.ok(f.roots().every(root=>!root.resolved&&!root.applied));}finally{f.db.close();}
});
test('current head, comparison, comment content and branch locks are rechecked in the serialized writer',()=>{
 for(const change of [{commit:sha('d')},{anchor:sha('d')},{comments:[]}]){const f=fixture();try{assert.throws(()=>f.apply({...f.command,...change}),/changed|different suggestions/);assert.equal(f.branch('feature').commit,sha('b'));}finally{f.db.close();}}
 const f=fixture();try{new Policies(f.sql).set({branch:'feature',pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true});assert.throws(()=>f.apply(),/locked/);assert.ok(f.roots().every(root=>!root.applied));}finally{f.db.close();}
});
