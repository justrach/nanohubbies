import assert from 'node:assert/strict';
import {teamFixture} from './team/fixture.ts';
const f=await teamFixture();
try {
  const owner=await f.login('context-owner','101');
  const other=await f.login('context-other','202');
  const base='/api/trunks/context-access';
  await f.json('POST',base,{files:[{path:'README.md',text:'fixture'}]},owner);
  assert.equal((await f.json('GET',base+'/github-context',undefined,owner)).canRefresh,true);
  assert.equal((await f.json('GET',base+'/github-context',undefined,other)).canRefresh,false);
  assert.equal((await f.request('POST',base+'/github-context',undefined,other)).status,403);
  assert.equal((await f.request('POST',base+'/github-context',undefined,{...owner,origin:'https://untrusted.example'})).status,403);
  assert.equal((await f.request('POST',base+'/github-context',undefined,{...owner,authorization:'Bearer agent-token'})).status,403);
  assert.equal((await f.request('POST',base+'/github-context',undefined,owner)).status,400);
  console.log('PASS: context refresh owner, human, same-origin, and imported-repository fences');
} finally { await f.close(); }
