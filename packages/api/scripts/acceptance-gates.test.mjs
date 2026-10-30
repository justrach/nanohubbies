import test from 'node:test';import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {acceptanceGateScript} from '../../../tools/acceptance-gates.mjs';
const exec=promisify(execFile);
async function fixture(run){const dir=await mkdtemp(join(tmpdir(),'nh-gates-'));try{const logs=join(dir,"Gate's logs");await mkdir(logs);await run(logs);}finally{await rm(dir,{recursive:true,force:true});}}
test('compound gate captures a failed first command and cannot run the second or a later gate',async()=>fixture(async logs=>{
 const script=acceptanceGateScript([['compound',"printf 'left output\\n'; printf 'left error\\n' >&2; false && printf 'UNEXPECTED RIGHT'"],['later',"printf 'UNEXPECTED LATER'"]],logs);
 let failure;try{await exec('/bin/sh',['-c',script]);}catch(error){failure=error;}assert.equal(failure?.code,1);assert.match(failure.stdout,/left output/);assert.match(failure.stdout,/left error/);assert.doesNotMatch(failure.stdout,/NANOHUB_GATE_PASS|UNEXPECTED/);
 assert.equal(await readFile(join(logs,'gate-compound.log'),'utf8'),'left output\nleft error\n');await assert.rejects(readFile(join(logs,'gate-later.log')),{code:'ENOENT'});
}));
test('a failed second command retains both commands output and has no success marker',async()=>fixture(async logs=>{
 const script=acceptanceGateScript([['compound',"printf 'first\\n' && { printf 'second error\\n' >&2; exit 17; }"]],logs);
 await assert.rejects(exec('/bin/sh',['-c',script]),error=>{assert.equal(error.code,1);assert.match(error.stdout,/first\nsecond error/);assert.doesNotMatch(error.stdout,/NANOHUB_GATE_PASS/);return true;});assert.equal(await readFile(join(logs,'gate-compound.log'),'utf8'),'first\nsecond error\n');
}));
test('successful compound and subsequent gates preserve their separate logs, including quoted directories',async()=>fixture(async logs=>{
 const script=acceptanceGateScript([['compound',"printf 'first\\n' && printf 'second\\n'"],['next',"printf 'third\\n'"]],logs),result=await exec('/bin/sh',['-c',script]);assert.equal(result.stderr,'');assert.match(result.stdout,/NANOHUB_GATE_PASS compound/);assert.match(result.stdout,/NANOHUB_GATE_PASS next/);assert.equal(await readFile(join(logs,'gate-compound.log'),'utf8'),'first\nsecond\n');assert.equal(await readFile(join(logs,'gate-next.log'),'utf8'),'third\n');
}));
test('invalid names, duplicate gates and unsafe log locations fail before shell execution',()=>{
 for(const gates of [[],[['../escape','true']],[['same','true'],['same','true']],[['name',null]],[['name','']], [['name','true\0false']]])assert.throws(()=>acceptanceGateScript(gates));assert.throws(()=>acceptanceGateScript([['gate','true']],'relative'));
});
