import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:[new URL('../src/cli/credentials.ts',import.meta.url).pathname,new URL('../../../apps/web/src/lib/cli-scopes.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',write:false,outdir:'/virtual'});
const [{cliScopes,requestedScopes,cliScopeAllowed,cliScopeWrites,cliAdminScope},{cliPermissions,cliReadScope,cliArchivedScope,toggleCliScope}]=await Promise.all(built.outputFiles.map(file=>import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))));
test('all secret capabilities require current admin authority, including metadata reads',()=>{
 for(const role of ['reader','writer','member','unknown'])for(const scope of ['secrets:read','secrets:write','secrets:grant'])assert.equal(cliScopeAllowed(scope,role,true),false);
 for(const role of ['owner','admin'])for(const scope of ['secrets:read','secrets:write','secrets:grant']){assert.equal(cliScopeAllowed(scope,role,true),true);assert.equal(cliAdminScope(scope),true);}
 assert.equal(cliScopeWrites('secrets:read'),false);assert.equal(cliScopeWrites('secrets:grant'),true);
});
test('archived repositories permit metadata and revocation delegation but cannot receive reference-write delegation',()=>{
 for(const role of ['owner','admin']){assert.equal(cliScopeAllowed('secrets:read',role,false),true);assert.equal(cliScopeAllowed('secrets:grant',role,false),true);assert.equal(cliScopeAllowed('secrets:write',role,false),false);}
 assert.equal(cliArchivedScope('secrets:read'),true);assert.equal(cliArchivedScope('secrets:grant'),true);assert.equal(cliArchivedScope('secrets:write'),false);assert.equal(cliReadScope('secrets:read'),true);
});
test('new capabilities are explicit and reference/grant access cannot be requested without metadata consent',()=>{
 assert.deepEqual(requestedScopes(['read']),['read']);for(const permission of ['secrets:write','secrets:grant'])assert.throws(()=>requestedScopes(['read',permission]),/secrets:read/);
 assert.deepEqual(requestedScopes(['secrets:grant','read','secrets:read']),['read','secrets:read','secrets:grant']);assert.equal(new Set(cliScopes).size,cliScopes.length);
});
test('consent labels and dependency toggles match every server capability without implicitly approving grants',()=>{
 assert.deepEqual([...cliPermissions.map(([scope])=>scope)].sort(),[...cliScopes].sort());
 assert.deepEqual(toggleCliScope(['read'],'secrets:read',true),['read','secrets:read']);
 assert.deepEqual(toggleCliScope(['read'],'secrets:grant',true),['read','secrets:grant','secrets:read']);
 assert.deepEqual(toggleCliScope(['read','secrets:read','secrets:write','secrets:grant'],'secrets:read',false),['read']);
 assert.match(cliPermissions.find(([scope])=>scope==='secrets:grant')[1],/stop when this credential expires or is revoked/);
});
