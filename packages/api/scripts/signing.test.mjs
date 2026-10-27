import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {generateKey,readKey,revokeKey,readPrivateKey,createMessage,sign} from 'openpgp';

// macOS AF_UNIX socket paths must leave room for GnuPG's agent socket name.
const dir=await mkdtemp(join(process.platform==='darwin'?'/tmp':tmpdir(),'nh-sig-')),exec=promisify(execFile),email='signer@example.invalid',owner={id:'fixture:signer',name:'Signer'};
await build({entryPoints:[new URL('../src/signing/index.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'esm',outfile:join(dir,'signing.mjs')});
const {signedPayload,sshKey,sshSignatureAlias,verifySSH,pgpKey,verifyPGP,SigningKeys,verifyCommit}=await import(pathToFileURL(join(dir,'signing.mjs')).href);
const command=async(name,args,options={})=>exec(name,args,{timeout:30000,...options}),gnupg=join(dir,'gnupg');await mkdir(gnupg,{mode:0o700});const gpgEnv={...process.env,GNUPGHOME:gnupg};
// Relocated package-manager installs can retain a stale compiled agent path.
const agent=(await command('sh',['-c','command -v gpg-agent'])).stdout.trim();await writeFile(join(gnupg,'gpg.conf'),`agent-program ${agent}\n`);
after(async()=>{await command('gpgconf',['--kill','gpg-agent'],{env:gpgEnv}).catch(()=>{});await rm(dir,{recursive:true,force:true});});
const hash=raw=>createHash('sha1').update(`commit ${raw.length}\0`).update(raw).digest('hex');
function fixture(){const db=new DatabaseSync(':memory:'),sql={exec(query,...args){const rows=db.prepare(query).all(...args);return {toArray:()=>rows};}},keys=new SigningKeys(sql);return {db,sql,keys};}
const fixtures=new Map();
async function sshFixture(type,bits){const id=type+(bits??''),key=join(dir,id),repo=join(dir,'repo-'+id);await mkdir(repo);await command('ssh-keygen',['-q','-t',type,...(bits?['-b',String(bits)]:[]),'-N','','-f',key]);const pub=await readFile(key+'.pub','utf8'),git=async(...args)=>(await command('git',['-C',repo,...args])).stdout.trim();await git('init','-b','main');await git('config','user.name','Fixture');await git('config','user.email',email);await git('config','gpg.format','ssh');await git('config','user.signingkey',key);await git('config','commit.gpgsign','true');await writeFile(join(repo,'README.md'),'Signed fixture\n');await git('add','.');await git('commit','-m','Signed candidate');const raw=(await command('git',['-C',repo,'cat-file','commit','HEAD'],{encoding:'buffer'})).stdout,allowed=join(dir,id+'-allowed');await writeFile(allowed,`${email} ${pub}`);await git('-c',`gpg.ssh.allowedSignersFile=${allowed}`,'verify-commit','HEAD');const value={pub,raw,key,repo,git};fixtures.set(id,value);return value;}
test('native Git/OpenSSH Ed25519, RSA and all NIST ECDSA commit signatures verify',async()=>{
 for(const [type,bits] of [['ed25519'],['rsa',2048],['ecdsa',256],['ecdsa',384],['ecdsa',521]]){
  const f=await sshFixture(type,bits),key=sshKey(f.pub),signed=signedPayload(f.raw);assert.equal(signed.email,email);assert.equal(signed.kind,'ssh');assert.equal(sshSignatureAlias(signed.signature),key.id);verifySSH(signed.payload,signed.signature,key.publicKey);
  const changed=Buffer.from(signed.payload);changed[changed.length-2]^=1;assert.throws(()=>verifySSH(changed,signed.signature,key.publicKey),/does not verify/);
 }
});
test('SSH malformed armor, namespace/version/hash changes, wrong keys and private key material reject',async()=>{
 const f=fixtures.get('ed25519'),signed=signedPayload(f.raw),other=fixtures.get('ecdsa256');
 assert.throws(()=>verifySSH(signed.payload,signed.signature,other.pub),/match/);assert.throws(()=>sshKey('-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n-----END OPENSSH PRIVATE KEY-----'),/public key/);
 const bytes=Buffer.from(signed.signature.split('\n').slice(1,-1).join(''),'base64');bytes.writeUInt32BE(2,6);const armor='-----BEGIN SSH SIGNATURE-----\n'+bytes.toString('base64')+'\n-----END SSH SIGNATURE-----';assert.throws(()=>sshSignatureAlias(armor),/version/);
 const payload=join(dir,'namespace-payload');await writeFile(payload,signed.payload);await command('ssh-keygen',['-Y','sign','-f',f.key,'-n','file',payload]);const wrongNamespace=await readFile(payload+'.sig','utf8');assert.throws(()=>verifySSH(signed.payload,wrongNamespace,f.pub),/namespace/);
 assert.throws(()=>sshSignatureAlias(signed.signature.replace(/\n[A-Za-z0-9+/=]+\n/,'\n%%%\n')),/armor|base64/);
});
test('commit extraction preserves exact unsigned bytes, folded headers, binary message bytes and rejects ambiguity',()=>{
 const f=fixtures.get('ed25519'),s=signedPayload(f.raw),raw=Buffer.from(f.raw),begin=raw.indexOf(Buffer.from('gpgsig ')),end=raw.indexOf(Buffer.from('\n\n')),expected=Buffer.concat([raw.subarray(0,begin),raw.subarray(end+1)]);assert.deepEqual(s.payload,expected);
 const altered=Buffer.concat([raw,Buffer.from([0xff,0,13,10])]);assert.deepEqual(signedPayload(altered).payload,Buffer.concat([expected,Buffer.from([0xff,0,13,10])]));
 const fold=Buffer.from('mergetag object '+ 'a'.repeat(40)+'\n type commit\n tag fixture\n');const prefix=raw.indexOf(Buffer.from('gpgsig '));const withFold=Buffer.concat([raw.subarray(0,prefix),fold,raw.subarray(prefix)]);assert.ok(Buffer.from(signedPayload(withFold).payload).includes(fold));
 assert.throws(()=>signedPayload(s.payload),/unsigned/);assert.throws(()=>signedPayload(Buffer.concat([raw.subarray(0,end),Buffer.from('\ngpgsig duplicate'),raw.subarray(end)])),/Multiple/);assert.throws(()=>signedPayload(Buffer.concat([raw.subarray(0,end),Buffer.from(`\ncommitter Other <${email}> 1 +0000`),raw.subarray(end)])),/email/);assert.throws(()=>signedPayload(new Uint8Array(256*1024+1)),/limit/);
});
let pgpFixture;
test('real Git/GnuPG detached commit signatures verify with account email and reject tampering',async()=>{
 await command('gpg',['--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key',`Signing Fixture <${email}>`,'ed25519','sign','0'],{env:gpgEnv});
 const pub=(await command('gpg',['--armor','--export',email],{env:gpgEnv})).stdout,key=await pgpKey(pub,[email]),repo=join(dir,'repo-pgp');await mkdir(repo);
 const git=async(...args)=>(await command('git',['-C',repo,...args],{env:gpgEnv})).stdout.trim();await git('init','-b','main');await git('config','user.name','GPG Fixture');await git('config','user.email',email);await git('config','user.signingkey',key.fingerprint);await git('config','commit.gpgsign','true');await writeFile(join(repo,'README.md'),'PGP fixture\n');await git('add','.');await git('commit','-m','PGP candidate');await git('verify-commit','HEAD');
 const raw=(await command('git',['-C',repo,'cat-file','commit','HEAD'],{env:gpgEnv,encoding:'buffer'})).stdout,s=signedPayload(raw);assert.equal(s.kind,'pgp');await verifyPGP(s.payload,s.signature,key.publicKey,email);await assert.rejects(verifyPGP(Buffer.concat([s.payload,Buffer.from('tampered')]),s.signature,key.publicKey,email));await assert.rejects(pgpKey(pub,['someone-else@example.invalid']),/matching/);await assert.rejects(verifyPGP(s.payload,s.signature,key.publicKey,'someone-else@example.invalid'));pgpFixture={pub,key,raw};
});
test('account key ownership is unique, foreign revocation denied and signer email cannot be asserted',async()=>{
 const f=fixture();try{const key=sshKey(fixtures.get('ed25519').pub);f.keys.add(key,'Laptop',owner,[email]);assert.throws(()=>f.keys.add(key,'Hijacked',{id:'other',name:'Other'},[email]),/another account/);assert.throws(()=>f.keys.revoke('other',key.id),/No such/);assert.equal(f.keys.list('other').length,0);assert.equal(f.keys.list(owner.id)[0].publicKey,key.publicKey);
 const raw=fixtures.get('ed25519').raw,result=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>body());assert.equal(result.verified,true);assert.equal(result.receipt.signer.id,owner.id);const spoof=Buffer.from(raw.toString().replace(email,'other@example.invalid'));assert.equal((await verifyCommit(f.sql,'repo',hash(spoof),spoof,body=>body())).verified,false);assert.equal((await verifyCommit(f.sql,'repo','f'.repeat(40),raw,body=>body())).verified,false);
 }finally{f.db.close();}
});
test('verification persists by repository after key revocation, while new commits and other repositories fail',async()=>{
 for(const [parsed,raw] of [[sshKey(fixtures.get('ed25519').pub),fixtures.get('ed25519').raw],[pgpFixture.key,pgpFixture.raw]]){const f=fixture();try{f.keys.add(parsed,'Signing key',owner,[email]);const sha=hash(raw),first=await verifyCommit(f.sql,'repo',sha,raw,body=>body());assert.equal(first.verified,true);f.keys.revoke(owner.id,parsed.id);const retry=await verifyCommit(f.sql,'repo',sha,raw,body=>body());assert.deepEqual(retry,first);assert.equal((await verifyCommit(f.sql,'another-repo',sha,raw,body=>body())).verified,false);assert.throws(()=>f.keys.add(parsed,'Again',owner,[email]),/revoked/);assert.equal(f.keys.receipt('another-repo',sha),null);}finally{f.db.close();}}
});
test('a key revoked while cryptographic work runs cannot mint a new verification receipt',async()=>{
 const f=fixture();try{const key=pgpFixture.key,raw=pgpFixture.raw;f.keys.add(key,'Raced key',owner,[email]);const result=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>{f.keys.revoke(owner.id,key.id);return body();});assert.equal(result.verified,false);assert.match(result.reason,/revoked before/);assert.equal(f.keys.receipt('repo',hash(raw)),null);}finally{f.db.close();}
});
test('expired and cryptographically revoked OpenPGP keys cannot enroll',async()=>{
 const created=new Date(Date.now()-3600000),expired=await generateKey({type:'ecc',curve:'ed25519Legacy',userIDs:[{email}],date:created,keyExpirationTime:60});await assert.rejects(pgpKey(expired.publicKey,[email]));
 const payload=Buffer.from('A backdated signature cannot revive an expired key'),oldSignature=await sign({message:await createMessage({binary:payload}),signingKeys:await readPrivateKey({armoredKey:expired.privateKey}),date:new Date(created.getTime()+30000),detached:true});await assert.rejects(verifyPGP(payload,oldSignature,expired.publicKey,email));
 const valid=await generateKey({type:'ecc',curve:'ed25519Legacy',userIDs:[{email}]});const revoked=await revokeKey({key:await readKey({armoredKey:valid.publicKey}),revocationCertificate:valid.revocationCertificate});await assert.rejects(pgpKey(revoked.publicKey,[email]));
 await assert.rejects(pgpKey(valid.privateKey,[email]),/public key/);
});
test('current-email proof is checked before cryptography and again before minting a receipt',async()=>{
 const f=fixture();try{const key=sshKey(fixtures.get('ed25519').pub),raw=fixtures.get('ed25519').raw;f.keys.add(key,'Email fixture',owner,[email]);let calls=0;const denied=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>body(),async()=>++calls===1);assert.equal(denied.verified,false);assert.match(denied.reason,/verification changed/);assert.equal(f.keys.receipt('repo',hash(raw)),null);const accepted=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>body(),async()=>true);assert.equal(accepted.verified,true);const retained=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>body(),async()=>false);assert.deepEqual(retained,accepted);}finally{f.db.close();}
});
test('persistent verification binds the exact commit bytes with a SHA-256 digest',async()=>{
 const f=fixture();try{const key=sshKey(fixtures.get('ed25519').pub),raw=fixtures.get('ed25519').raw;f.keys.add(key,'Digest fixture',owner,[email]);const first=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>body());assert.equal(first.receipt.objectDigest,createHash('sha256').update(raw).digest('hex'));f.sql.exec('UPDATE verified_commit_signatures SET data=?',JSON.stringify({...first.receipt,objectDigest:'0'.repeat(64)}));const result=await verifyCommit(f.sql,'repo',hash(raw),raw,body=>body());assert.equal(result.verified,false);assert.match(result.reason,/Commit bytes differ/);}finally{f.db.close();}
});
