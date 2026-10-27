import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const dir=await mkdtemp(join(tmpdir(),'nh-ref-unit-')),file=join(dir,'module.mjs');after(()=>rm(dir,{recursive:true,force:true}));
const built=await build({stdin:{contents:`export * from './src/repository/ref-name';export * from './src/repository/pattern';export * from './src/repository/store';export * from './src/repository/policy';export * from './src/receive';export * from './src/ci/ref';export * from './src/connect';export {parseRepo} from './src/importer';`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,platform:'node',format:'esm',write:false});await writeFile(file,built.outputFiles[0].text);
const {branchName,tagName,refName,newRefName,patternLines,branchPattern,matchesBranch,matchesGlob,Repository,Policies,readRequest,advertise,runRef,branchWorkCommands,parseRepo}=await import(pathToFileURL(file));
const names=['日本語/修正','🚀/one','nfc/café','nfd/cafe\u0301','@','HEAD','-leading','_under','+plus','!ready',`quotes/'"`, 'cash/$USER','literal/$(touch${IFS}SENTINEL)','chars/;<>&=#%+!`{}]','white/\u00a0','\ufeffBOM','line/\u2028next','a./b'];
const invalid=['','/leading','trailing/','two//parts','.hidden','a/.hidden','x.lock/a','foo..bar','x.','a b','a\t','a\n','a\r','a\0','x~','x^','x:','x?','x*','x[','x\\','a@{b','\ud800','\udc00'];
test('UTF-8 ref syntax agrees with real Git, preserves code points and enforces full-ref byte bounds',()=>{
 for(const name of names){assert.equal(spawnSync('git',['check-ref-format','refs/heads/'+name]).status,0,name);assert.equal(branchName(name),name);assert.equal(tagName(name),name);assert.equal(refName('refs/heads/'+name),'refs/heads/'+name);}
 for(const name of invalid){if(!name.includes('\ud800')&&!name.includes('\udc00')&&!name.includes('\0'))assert.notEqual(spawnSync('git',['check-ref-format','refs/heads/'+name]).status,0,JSON.stringify(name));assert.throws(()=>branchName(name),/Invalid Git ref/);}
 assert.equal(branchName('a'.repeat(244)).length,244);assert.throws(()=>branchName('a'.repeat(245)),/255 bytes/);assert.equal(tagName('a'.repeat(245)).length,245);assert.throws(()=>tagName('a'.repeat(246)),/255 bytes/);
 assert.equal(branchName('分'.repeat(81)+'a'),'分'.repeat(81)+'a');assert.throws(()=>branchName('分'.repeat(82)),/255 bytes/);assert.notEqual(branchName('café'),branchName('cafe\u0301'));
});
test('new GitHub ambiguity restrictions do not strand names stored by older versions',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};try{sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();
 for(const suffix of ['a'.repeat(40),'refs/legacy']){const full='refs/heads/'+suffix;assert.equal(refName(full),full);assert.throws(()=>newRefName(full),/New branch/);assert.throws(()=>repo.update(full,null,{commit:'a'.repeat(40),tree:'1'.repeat(40)},true,'owner'),/New branch/);
  sql.exec('INSERT INTO repository_refs VALUES(?,?,?,?)',full,'a'.repeat(40),'1'.repeat(40),Date.now());repo.update(full,'a'.repeat(40),{commit:'b'.repeat(40),tree:'2'.repeat(40)},true,'owner');repo.update(full,'b'.repeat(40),null,true,'owner');assert.ok(!repo.refs().some(ref=>ref.name===full));}
 }finally{db.close();}
});
test('literal Unicode, punctuation, braces and long ref targets are protectable without changing glob meaning',()=>{
 for(const name of [...names,'a'.repeat(244)]){assert.equal(branchPattern(name),name);assert.equal(matchesBranch(name,name),true);assert.equal(matchesBranch(name,name+'x'),false);}
 assert.equal(matchesGlob('{main,release}','main'),false);assert.equal(matchesGlob('{main,release}','{main,release}'),true);assert.equal(matchesGlob('qa/**','qa/日本語/🔒'),true);assert.equal(matchesGlob('?.key','🔒.key'),true);assert.throws(()=>branchPattern('bad[^set]'),/Unsupported/);
 assert.deepEqual(patternLines(' \tfoo\r\nwhite/\u00a0\nline/\u2028next\n\ufeffBOM\n'),['foo','white/\u00a0','line/\u2028next','\ufeffBOM']);
});
const pkt=bytes=>Buffer.concat([Buffer.from((bytes.length+4).toString(16).padStart(4,'0')),bytes]);
const line=(name,extra='')=>Buffer.from('0'.repeat(40)+' '+'a'.repeat(40)+' refs/heads/'+name+extra+'\n');
test('Git wire framing preserves Unicode whitespace exactly and refuses malformed UTF-8 and ambiguous commands',async()=>{
 for(const name of names){const body=Buffer.concat([pkt(line(name,'\0report-status')),Buffer.from('0000')]);assert.equal(readRequest(body).commands[0].ref,'refs/heads/'+name);const text=await advertise([], 'a'.repeat(40)+'\trefs/heads/'+name+'\n',true).text();assert.ok(text.includes('refs/heads/'+name+'\0'),JSON.stringify(name));}
 for(const body of [Buffer.concat([pkt(Buffer.concat([line('bad').subarray(0,-1),Buffer.from([0xff,10])])),Buffer.from('0000')]),pkt(line('unterminated')),Buffer.from('zzzz'),Buffer.from('0009short'),Buffer.concat([pkt(line('one',' extra')),Buffer.from('0000')]),Buffer.concat([pkt(line('one','\0report-status')),pkt(line('two','\0other')),Buffer.from('0000')])])assert.throws(()=>readRequest(body));
});
test('CI and import ref selections preserve Unicode separators, percent signs, hashes and whitespace',()=>{
 for(const name of names)for(const kind of ['heads','tags'])assert.equal(runRef({branch:name,head:'a'.repeat(40),ref:'refs/'+kind+'/'+name}),`refs/${kind}/${name}`);
 assert.deepEqual(parseRepo('owner/repo#修正/#literal%2F\u00a0'),{owner:'owner',repo:'repo',ref:'修正/#literal%2F\u00a0'});assert.equal(parseRepo(' owner/repo ').ref,null);
 const commands=branchWorkCommands(`literal/$(touch\u0024{IFS}SENTINEL)'`);assert.match(commands,/git fetch origin 'refs\/heads\//);assert.match(commands,/git switch --detach FETCH_HEAD/);assert.match(commands,/git push origin 'HEAD:refs\/heads\//);assert.ok(commands.includes("'\\''"));
});
test('stored canonical spellings and case variants remain distinct, including exact lock targeting',()=>{
 const db=new DatabaseSync(':memory:'),sql={exec(q,...args){const rows=db.prepare(q).all(...args);return{toArray:()=>rows};}};
 try{sql.exec('CREATE TABLE versions(version INTEGER PRIMARY KEY,commit_sha TEXT,tree_sha TEXT)');const repo=new Repository(sql);repo.initialize();const names=['same/café','same/cafe\u0301','same/Case','same/case'];for(const name of names)repo.update('refs/heads/'+name,null,{commit:'a'.repeat(40),tree:'1'.repeat(40)},true,'owner');assert.equal(repo.refs().length,4);
  new Policies(sql).set({branch:names[0],pullRequest:false,approvals:0,checks:[],beforeOpen:[],preventForce:true,preventDelete:true,locked:true});
  assert.throws(()=>repo.update('refs/heads/'+names[0],'a'.repeat(40),{commit:'b'.repeat(40),tree:'2'.repeat(40)},true,'owner'),/locked/);
  repo.update('refs/heads/'+names[1],'a'.repeat(40),{commit:'b'.repeat(40),tree:'2'.repeat(40)},true,'owner');assert.equal(repo.refs().find(ref=>ref.name==='refs/heads/'+names[0]).commit,'a'.repeat(40));assert.equal(repo.refs().find(ref=>ref.name==='refs/heads/'+names[1]).commit,'b'.repeat(40));
 }finally{db.close();}
});
