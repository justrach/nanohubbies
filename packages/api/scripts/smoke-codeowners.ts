import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {teamFixture} from "./team/fixture.ts";
const f=await teamFixture(),exec=promisify(execFile),trunk="codeowners-git",base=`/api/trunks/${trunk}`;
try {
  const author=await f.login("author","101"),reviewer=await f.login("reviewer","202"),backup=await f.login("backup","303");
  for(const [name,who] of [["author",author],["reviewer",reviewer],["backup",backup]] as const)
    await f.json("POST","/api/namespaces",{name},who);
  await f.json("POST",base,{mode:"git"},author);
  for(const [id,who] of [["reviewer",reviewer],["backup",backup]] as const) {
    const invite=await f.json("POST",`${base}/collaborators`,{userId:`codegraff:${id}`,role:"writer"},author);
    await f.json("POST","/api/invitations/accept",{trunk,token:invite.token},who);
  }
  const providerCalls=f.provider.calls;f.provider.down=true;
  const issued=await f.json("POST",`${base}/git-tokens`,{label:"CODEOWNERS standard Git"},author);
  const source=join(f.dir,"source");await mkdir(join(source,".github"),{recursive:true});
  const git=async(...args:string[])=>(await exec("git",["-C",source,"-c","user.name=Fixture author","-c","user.email=author@example.invalid",...args],{env:{...process.env,GIT_TERMINAL_PROMPT:"0"}})).stdout.trim();
  await git("init","-b","main");
  await writeFile(join(source,".github/CODEOWNERS"),"* @ReViewer @backup\n/.github/CODEOWNERS @ReViewer @backup\n");
  await writeFile(join(source,"README.md"),"Initial\n");await git("add",".");await git("commit","-m","Initial owned repository");
  const initial=await git("rev-parse","HEAD"),remote=`${f.origin}/git/${trunk}.git`;
  // Local helpers otherwise append to an inherited OS helper, which can return
  // a stale localhost credential before the isolated fixture helper is asked.
  await git("config","credential.helper","");
  await git("config","--add","credential.helper",`!f() { test "$1" = get && printf 'username=git\\npassword=%s\\n' "$NANOHUB_CODEOWNER_TEST_TOKEN"; }; f`);
  await git("config","credential.useHttpPath","true");
  const transport=async(...args:string[])=>exec("git",["-C",source,...args],{env:{...process.env,GIT_TERMINAL_PROMPT:"0",NANOHUB_CODEOWNER_TEST_TOKEN:issued.token}});
  await transport("push",remote,"main");
  const policy={branch:"main",pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,requireCodeOwnerReview:true};
  await f.json("PUT",`${base}/protection`,policy,author);
  await git("checkout","-b","feature");await writeFile(join(source,"README.md"),"Owned change\n");
  // A PR cannot change its own ownership requirements through the head version.
  await writeFile(join(source,".github/CODEOWNERS"),"* @author\n");
  await git("add",".");await git("commit","-m","Change files and attempted head ownership");await transport("push",remote,"feature");
  await assert.rejects(transport("push",remote,"HEAD:main"),/reviewed pull request/);
  await f.json("POST",`${base}/pulls`,{title:"Owned change",head:"feature"},author);
  let head=await git("rev-parse","HEAD");
  const view=()=>f.json("GET",`${base}/pulls/1`,undefined,author);
  let snapshot=await view();assert.equal(snapshot.codeOwners.file,".github/CODEOWNERS");
  assert.equal(snapshot.codeOwners.required,true);assert.ok(snapshot.codeOwners.missing>0);
  assert.ok(snapshot.codeOwners.groups.every((g:{owners:string[]})=>g.owners.includes("@ReViewer")),"Base ownership wins over the proposed head");
  const observed=()=>({commit:head,anchor:initial});
  const merge=()=>f.request("POST",`${base}/pulls/1/merge`,{...observed(),codeOwners:{base:initial,head,groups:[]},codeOwnerAccounts:{"@ReViewer":"codegraff:author"}},author);
  await f.json("POST",`${base}/pulls/1/reviews`,{...observed(),verdict:"APPROVE"},author);
  assert.equal((await merge()).status,400,"Author approval and injected ownership JSON cannot bypass the gate");
  await f.json("POST",`${base}/agents`,{handle:"reviewer-bot",type:"test"},reviewer);
  const agent=await f.json("POST",`${base}/agents/reviewer-bot/token`,{},reviewer);
  await f.json("POST",`${base}/pulls/1/reviews`,{...observed(),verdict:"APPROVE"},{authorization:`Basic ${btoa(`reviewer-bot:${agent.token}`)}`});
  assert.equal((await merge()).status,400,"The owning account's agent cannot supply independent approval");
  await f.json("POST",`${base}/pulls/1/reviews`,{...observed(),verdict:"APPROVE"},reviewer);
  assert.equal((await view()).codeOwners.missing,0);
  await f.json("PATCH",`${base}/collaborators`,{userId:"codegraff:reviewer",role:"reader"},author);
  assert.ok((await view()).codeOwners.missing>0);assert.equal((await merge()).status,400,"Demoted owner approval does not cover the remaining writable owner");
  await writeFile(join(source,"README.md"),"New revision\n");await git("add",".");await git("commit","-m","New review revision");await transport("push",remote,"feature");head=await git("rev-parse","HEAD");
  assert.ok((await view()).codeOwners.missing>0);
  await f.json("POST",`${base}/pulls/1/reviews`,{...observed(),verdict:"APPROVE"},backup);
  snapshot=await view();assert.equal(snapshot.codeOwners.missing,0);
  const merged=await f.json("POST",`${base}/pulls/1/merge`,observed(),author);
  assert.equal(merged.pulls[0].mergedCommit,head);
  const archived=await view();assert.equal(archived.codeOwners.base,initial);assert.equal(archived.codeOwners.head,head);assert.equal(archived.codeOwners.missing,0);
  const clone=join(f.dir,"clone"),auth=`Basic ${btoa(`git:${issued.token}`)}`;
  await exec("git",["-c",`http.extraHeader=Authorization: ${auth}`,"clone",remote,clone]);
  assert.equal((await exec("git",["-C",clone,"rev-parse","HEAD"])).stdout.trim(),head);await exec("git",["-C",clone,"fsck","--strict"]);
  assert.equal(f.provider.calls,providerCalls,"Native ownership does not depend on Codegraff room membership");
  await f.json("DELETE",`/api/tokens/${issued.id}`,undefined,author);
  console.log("PASS: CODEOWNERS base-file enforcement, standard Git/PR merge, stable handle identities, author/agent denial, current write membership, new-revision reviews and archived receipt");
}finally{await f.close();}
