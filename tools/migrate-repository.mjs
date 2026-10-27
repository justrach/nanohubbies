/** Lossless migration of COMMITTED refs only. The source checkout is read-only.
 * Usage: NANOHUB_TOKEN=... node tools/migrate-repository.mjs SOURCE REMOTE HANDLE
 * Create the destination as mode:git first; use a registered workspace credential. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export async function migrate(source, remote, handle, token, progress = () => {}) {
  const url = new URL(remote);
  const address=url.pathname.match(/^\/git\/([a-z0-9][a-z0-9-]{0,62})(?:\/([a-z0-9][a-z0-9._-]{0,99}))?\.git\/?$/);
  if (url.username || url.password || url.search || url.hash || !/^https?:$/.test(url.protocol) || !address) throw Error('Use a plain Nanohub Git URL without credentials');
  if (url.protocol !== 'https:' && !['127.0.0.1','localhost'].includes(url.hostname)) throw Error('HTTPS required');
  const git = async (...args) => (await exec('git', ['-C', source, ...args], { maxBuffer: 128 << 20, encoding: 'buffer' })).stdout;
  if((await git('rev-parse','--is-shallow-repository')).toString().trim()==='true')throw Error('Fetch complete history before migrating; a shallow source cannot prove lossless history');
  await git('fsck','--strict');
  const refs = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await git('for-each-ref','--format=%(objectname) %(refname)','refs/heads','refs/tags')).split('\n').filter(Boolean);
  const auth = { Authorization: 'Basic ' + Buffer.from(`${handle}:${token}`).toString('base64') };
  const base=address[2]?`${url.origin}/api/repos/${address[1]}/${address[2]}/repository`:`${url.origin}/api/trunks/${address[1]}/repository`;
  const snapshot = await fetch(base,{headers:auth});
  if (!snapshot.ok) throw Error(`Cannot read destination: ${snapshot.status}`);
  const state = await snapshot.json();
  if (state.mode !== 'git' || state.refs.length) throw Error('Migration requires a new, empty Git repository; no existing ref is overwritten');
  const initialImportMaxRefs=state.initialImportMaxRefs??100;
  if(!Number.isSafeInteger(initialImportMaxRefs)||initialImportMaxRefs<1||initialImportMaxRefs>10_000||refs.length>initialImportMaxRefs)throw Error(`Destination supports at most ${initialImportMaxRefs} initial refs; no objects uploaded`);
  const branch=state.defaultBranch??'main';
  if(!refs.some(ref=>ref.endsWith(` refs/heads/${branch}`)))throw Error(`Destination default branch ${branch} is absent from the source; create the destination with a matching initial defaultBranch`);
  const ids = (await git('rev-list','--objects','--no-object-names',...refs.map(r=>r.split(' ')[0]))).toString().trim().split('\n');
  const descriptions = (await git('cat-file','--batch-check=%(objectname) %(objecttype) %(objectsize)','--batch-all-objects')).toString().trim().split('\n');
  const metadata = new Map(descriptions.map(l=>{const [sha,type,size]=l.split(' ');return [sha,{type,size:Number(size)}];}));
  const types={commit:1,tree:2,blob:3,tag:4}; let entries=[], bytes=0, stored=0;
  async function flush() {
    if (!entries.length) return;
    const header=Buffer.alloc(12);header.write('PACK');header.writeUInt32BE(2,4);header.writeUInt32BE(entries.length,8);
    const payload=Buffer.concat([header,...entries]);const pack=Buffer.concat([payload,createHash('sha1').update(payload).digest()]);
    const response=await fetch(`${base}/objects`,{method:'POST',headers:{...auth,'Content-Type':'application/x-git-packed-objects'},body:pack});
    if (!response.ok) throw Error(`Object upload failed (${response.status}): ${await response.text()}`);
    stored+=entries.length; progress({stored,total:ids.length}); entries=[];bytes=0;
  }
  for(const sha of ids) {
    const obj=metadata.get(sha);if (!obj || !types[obj.type] || obj.size>16<<20) throw Error(`Unsupported or oversized object ${sha}; no refs published`);
    if(bytes+obj.size>4<<20) await flush();
    const body=await git('cat-file',obj.type,sha);
    const head=[types[obj.type]<<4|body.length&15];for(let n=Math.floor(body.length/16);n;n=Math.floor(n/128)){head[head.length-1]|=128;head.push(n&127);}
    entries.push(Buffer.concat([Buffer.from(head),deflateSync(body)]));bytes+=body.length;
  }
  await flush();
  const pkt=s=>Buffer.from((Buffer.byteLength(s)+4).toString(16).padStart(4,'0')+s);
  const commands=refs.map((line,i)=>{const [sha,ref]=line.split(' ');return pkt(`${'0'.repeat(40)} ${sha} ${ref}${i===0?'\0report-status':''}\n`);});
  const response=await fetch(`${url.href.replace(/\/$/,'')}/git-receive-pack`,{method:'POST',headers:{...auth,'Content-Type':'application/x-git-receive-pack-request'},body:Buffer.concat([...commands,Buffer.from('0000')])});
  progress({phase:"validating published refs",objects:stored});
  const report=await response.text();
  if(!response.ok || report.includes('ng ') || !report.includes('unpack ok')) throw Error(`Refs were not published: ${report}`);
  const dir=mkdtempSync(join(tmpdir(),'nanohub-verify-'));
  try {
    // Credentials are supplied only to Git's environment, never its URL or disk.
    const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'http.extraHeader',GIT_CONFIG_VALUE_0:auth.Authorization ? `Authorization: ${auth.Authorization}`:''};
    try { await exec('git',['clone','--mirror',url.href,join(dir,'copy.git')],{env}); }
    catch (error) { throw Error(`Verification clone failed: ${(error.stderr ?? error.message).slice(0,1500)}`); }
    const verify=async(...args)=>(await exec('git',['--git-dir',join(dir,'copy.git'),...args],{encoding:'utf8',maxBuffer:128<<20})).stdout.replace(/\n$/,'');
    await verify('fsck','--strict');
    const actual=await verify('for-each-ref','--format=%(objectname) %(refname)','refs/heads','refs/tags');
    if(actual!==refs.join('\n'))throw Error('Ref/ID mismatch after migration');
    for(const line of refs.filter(r=>r.includes(' refs/heads/'))){const sha=line.split(' ')[0];if(await verify('ls-tree','-rz',sha)!==(await git('ls-tree','-rz',sha)).toString().trim())throw Error(`Tree/mode mismatch at ${sha}`);}
    return {verified:true,objects:stored,refs:refs.length,fsck:'strict',scope:'committed branches and tags only; external LFS and submodules rejected'};
  } finally { rmSync(dir,{recursive:true,force:true}); }
}
if(import.meta.url === new URL(process.argv[1], 'file:').href) {
  const [source,remote,handle]=process.argv.slice(2);
  if(!source||!remote||!handle||!process.env.NANOHUB_TOKEN)throw Error('Usage: NANOHUB_TOKEN=... node tools/migrate-repository.mjs SOURCE REMOTE HANDLE');
  console.log(JSON.stringify(await migrate(source,remote,handle,process.env.NANOHUB_TOKEN),null,2));
}
