import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {teamFixture} from "./team/fixture.ts";
const f=await teamFixture(),exec=promisify(execFile),trunk="rule-insights",base=`/api/trunks/${trunk}`;
let tokenId:string|undefined,owner="";
try {
 owner=await f.login("owner","101");const writer=await f.login("writer","202"),admin=await f.login("admin","303"),reader=await f.login("reader","404");await f.json("POST",base,{mode:"git"},owner);
 for(const [id,role,cookie] of [["writer","writer",writer],["admin","admin",admin],["reader","reader",reader]]){const invite=await f.json("POST",`${base}/collaborators`,{userId:`codegraff:${id}`,role},owner);await f.json("POST","/api/invitations/accept",{trunk,token:invite.token},cookie);}
 const issued=await f.json("POST",`${base}/git-tokens`,{label:"Rule insights synthetic Git"},owner);tokenId=issued.id;
 const source=join(f.dir,"source");await mkdir(source);
 const git=async(...args:string[])=>(await exec("git",["-C",source,"-c","user.name=Insights fixture","-c","user.email=fixture@example.invalid",...args])).stdout.trim();
 const remote=`${f.origin}/git/${trunk}.git`,transport=async(...args:string[])=>exec("git",["-C",source,...args],{env:{...process.env,GIT_TERMINAL_PROMPT:"0",GIT_CONFIG_COUNT:"1",GIT_CONFIG_KEY_0:`http.${remote}.extraHeader`,GIT_CONFIG_VALUE_0:`Authorization: Basic ${btoa(`git:${issued.token}`)}`}});
 await git("init","-b","main");await writeFile(join(source,"README.md"),"Initial synthetic insights fixture\n");await git("add",".");await git("commit","-m","Initial base");const initial=await git("rev-parse","HEAD");await transport("push",remote,"main");
 const config=(extra:any={})=>({name:"Observe branch metadata",target:"branch",enforcement:"evaluate",conditions:{ref_name:{include:["refs/heads/observe/**"],exclude:[]}},rules:[{type:"commit_message_pattern",parameters:{operator:"starts_with",pattern:"feat:"}}],...extra});
 const paths=config({name:"Observe restricted files",target:"push",conditions:undefined,rules:[{type:"file_path_restriction",parameters:{restricted_file_paths:["blocked.txt"]}}]});
 const saved=await f.json("POST",`${base}/rulesets`,paths,owner);await f.json("POST",`${base}/rulesets`,config(),admin);await f.json("POST",`${base}/rulesets`,config({name:"Observe signatures",rules:[{type:"required_signatures"}]}),owner);
 const portable=await f.json("GET",`${base}/rulesets/${saved.id}/export`,undefined,owner);assert.equal(portable.enforcement,"evaluate");assert.equal((await f.json("POST",`${base}/rulesets/import/preview`,{configuration:portable},admin)).configuration.enforcement,"evaluate");
 const suites=async(query="",cookie=owner)=>f.json("GET",`${base}/rulesets/rule-suites${query}`,undefined,cookie);
 for(const cookie of [reader,writer])assert.equal((await f.request("GET",`${base}/rulesets/rule-suites`,undefined,cookie)).status,403);
 assert.equal((await f.request("POST",`${base}/rulesets/rule-suites`,{},owner)).status,405);
 for(const query of ["?limit=101","?result=unknown","?ref=bad","?ruleset=1.1","?from=4&to=2","?unknown=1"])assert.equal((await f.request("GET",`${base}/rulesets/rule-suites${query}`,undefined,owner)).status,400);
 const gitApi=await fetch(`${f.origin}${base}/rulesets/rule-suites`,{headers:{Authorization:`Bearer ${issued.token}`}});assert.notEqual(gitApi.status,200);
 await git("checkout","-b","observe/topic");await writeFile(join(source,"blocked.txt"),"Intermediate restricted path\n");await git("add",".");await git("commit","-m","bad intermediate subject");await git("rm","blocked.txt");await git("commit","-m","feat: clean tip");const observed=await git("rev-parse","HEAD");await transport("push",remote,"observe/topic");
 let page=await suites("?ref=refs%2Fheads%2Fobserve%2Ftopic",admin);assert.equal(page.suites.length,1);let suite=page.suites[0];assert.equal(suite.accepted,true);assert.equal(suite.result,"fail");assert.equal(suite.evaluations.length,3);assert.ok(suite.evaluations.every((r:any)=>r.enforcement==="evaluate"&&r.result==="fail"));assert.match(suite.evaluations[0].reasons.join(" "),/blocked.txt/);assert.equal(suite.next,observed);assert.equal(suite.source,"git");
 const detail=await f.request("GET",`${base}/rulesets/rule-suites/${suite.id}`,undefined,owner);assert.match(detail.headers.get("cache-control")??"",/no-store/);assert.deepEqual(await detail.json(),suite);assert.equal((await f.request("GET",`${base}/rulesets/rule-suites/999999`,undefined,owner)).status,404);assert.ok(!JSON.stringify(suite).includes(issued.token));
 await f.json("PUT",`${base}/rulesets/${saved.id}`,{...paths,enforcement:"active"},owner);await writeFile(join(source,"blocked.txt"),"Active restriction rejects this update\n");await git("add",".");await git("commit","-m","feat: blocked candidate");await assert.rejects(transport("push",remote,"observe/topic"),/restricted file path/);assert.equal((await transport("ls-remote",remote,"refs/heads/observe/topic")).stdout.split(/\s/)[0],observed);
 page=await suites("?result=fail&actor=codegraff%3Aowner&ruleset="+saved.id);suite=page.suites[0];assert.equal(suite.accepted,false);assert.match(suite.rejection,/restricted file path/);assert.equal(suite.evaluations.find((r:any)=>r.id===saved.id).enforcement,"active");
 await git("branch","observe/a-good",initial);await git("branch","observe/z-blocked");await assert.rejects(transport("push","--atomic",remote,"observe/a-good","observe/z-blocked"),/restricted file path/);
 assert.equal((await transport("ls-remote",remote,"refs/heads/observe/a-good","refs/heads/observe/z-blocked")).stdout.trim(),"");page=await suites();const batch=page.suites[0].batch,atomic=page.suites.filter((s:any)=>s.batch===batch);assert.equal(atomic.length,2);assert.ok(atomic.every((s:any)=>!s.accepted));assert.ok(atomic.some((s:any)=>s.ref==="refs/heads/observe/a-good"&&s.evaluations.find((r:any)=>r.id===saved.id).result==="pass"));
 const audit=await f.json("GET",`${base}/repository/audit?kind=refs`,undefined,owner);assert.ok(!audit.events.some((e:any)=>["refs/heads/observe/a-good","refs/heads/observe/z-blocked"].includes(e.ref)));
 await git("branch","safe/a",initial);await git("branch","safe/b",initial);await transport("push","--atomic",remote,"safe/a","safe/b");assert.equal((await transport("ls-remote",remote,"refs/heads/safe/a","refs/heads/safe/b")).stdout.trim().split("\n").length,2);
 // Native branch operations are observed as signed-human requests as well.
 await f.json("POST",`${base}/branches`,{name:"observe/copied",from:"main"},owner);suite=(await suites("?ref=refs%2Fheads%2Fobserve%2Fcopied")).suites[0];assert.equal(suite.source,"branch");assert.equal(suite.human,true);assert.equal(suite.accepted,true);
 const tags=await f.json("POST",`${base}/rulesets`,config({name:"Observe tag lifecycle",target:"tag",conditions:{ref_name:{include:["~ALL"],exclude:[]}},rules:[{type:"creation"}]}),owner);
 await git("tag","v1",initial);await transport("push",remote,"v1");suite=(await suites("?ref=refs%2Ftags%2Fv1")).suites[0];assert.equal(suite.accepted,true);assert.equal(suite.evaluations.find((r:any)=>r.id===tags.id).result,"fail");
 // Final PR merge failures are recorded after the entire review transaction rolls back.
 await f.json("PUT",`${base}/rulesets/${saved.id}`,{...paths,enforcement:"disabled"},owner);
 await git("checkout","-b","feature/merge",initial);await writeFile(join(source,"README.md"),"Reviewed merge candidate\n");await git("add",".");await git("commit","-m","feat: merge candidate");const candidate=await git("rev-parse","HEAD");await transport("push",remote,"feature/merge");
 await f.json("PUT",`${base}/protection`,{branch:"main",pullRequest:true,approvals:1,checks:[],beforeOpen:[],preventForce:true,preventDelete:true},owner);await f.json("POST",`${base}/pulls`,{title:"Insights protected merge",head:"feature/merge"},owner);
 let view=await f.json("GET",`${base}/pulls/1`,undefined,owner);await f.json("POST",`${base}/pulls/1/reviews`,{commit:view.head.commit,anchor:view.pull.anchor,verdict:"APPROVE"},writer);
 const mainRule=await f.json("POST",`${base}/rulesets`,config({name:"Main maintenance",enforcement:"active",conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},rules:[{type:"update"}]}),owner);
 let response=await f.request("POST",`${base}/pulls/1/merge`,{commit:view.head.commit,anchor:view.pull.anchor},owner);assert.equal(response.status,400);assert.match((await response.json() as any).error,/updates are restricted/);suite=(await suites("?ref=refs%2Fheads%2Fmain")).suites[0];assert.equal(suite.accepted,false);assert.equal(suite.source,"merge");assert.equal(suite.human,true);assert.equal((await f.json("GET",`${base}/pulls/1`,undefined,owner)).pull.state,"open");assert.equal((await transport("ls-remote",remote,"refs/heads/main")).stdout.split(/\s/)[0],initial);
 await f.json("PUT",`${base}/rulesets/${mainRule.id}`,config({name:"Main maintenance",enforcement:"evaluate",conditions:{ref_name:{include:["refs/heads/main"],exclude:[]}},rules:[{type:"update"}]}),owner);
 response=await f.request("POST",`${base}/pulls/1/merge`,{commit:view.head.commit,anchor:view.pull.anchor},owner);assert.equal(response.status,200);suite=(await suites("?ref=refs%2Fheads%2Fmain")).suites[0];assert.equal(suite.accepted,true);assert.equal(suite.result,"fail");assert.equal(suite.source,"merge");
 const filtered=await suites(`?from=${suite.at}&to=${suite.at}&ruleset=${mainRule.id}`);assert.equal(filtered.suites.length,1);
 const first=await suites("?limit=1");assert.equal(first.suites.length,1);assert.ok(first.nextCursor);const second=await suites(`?limit=1&before=${first.nextCursor}`);assert.ok(second.suites[0].id<first.suites[0].id);
 const clone=join(f.dir,"clone");await transport("clone",remote,clone);assert.equal((await exec("git",["-C",clone,"rev-parse","HEAD"])).stdout.trim(),candidate);await exec("git",["-C",clone,"fsck","--strict"]);
 console.log("PASS: real Git evaluate-mode path/metadata/signature observations, active rejection and atomic ref rollback, durable rejected merge insights, human/admin boundaries, filtering/pagination, protected merge and clone/fsck");
}finally{if(tokenId&&owner)await f.request("DELETE",`/api/tokens/${tokenId}`,undefined,owner).catch(()=>{});await f.close();}
