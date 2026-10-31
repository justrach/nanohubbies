import {spawn} from 'node:child_process';
import {basename,resolve} from 'node:path';
import {open} from 'node:fs/promises';
import cliPackage from '../package.json' with {type:'json'};
import {nativeCommand,storedApiToken} from './api.mjs';
import {importCommand} from './import.mjs';
import {browserLogin} from './device.mjs';
import {gitHelperCommand,gitCredentialHelper,configureGitHelper,requireGitAccess} from './git-credential.mjs';
export const help=`Usage: nh <command> [options]                (alias: nanohub)

  repo clone OWNER/REPO [DIRECTORY]          Clone with ordinary Git
  repo import SOURCE -R OWNER/REPO          Import complete history, refs and assets
  repo view [-R OWNER/REPO]                  Open repository in your browser
  repo default-branch [-R OWNER/REPO]        Read default branch, heads and settings revision
  repo edit --default-branch BRANCH         Select an existing branch (explicit admin permission)
  repo merge-settings [-R OWNER/REPO]       Read allowed methods, default and settings revision
  repo edit --allow-merge-methods METHODS   Set comma-separated methods with --default-merge-method and --revision
  repo archive-status [-R OWNER/REPO]        Read archive state and current revision
  repo archive --revision N --confirm NAME  Archive a repository (explicit admin permission)
  repo unarchive --revision N --confirm NAME Reopen it while preserving branch rules
  pr list [-R OWNER/REPO]                    List pull requests
  pr view NUMBER [-R OWNER/REPO]             Inspect a pull request (--web for hunk UI)
  pr diff NUMBER [-R OWNER/REPO]             Show the bounded changed-file diff
  pr create --title T --head B [--body T]   Open a pull request (--base uses the repository default)
  pr review NUMBER --verdict DECISION       comment, approve or request-changes; --body TEXT
  pr reviewers NUMBER                      Inspect requested reviewers and revision
  pr request-review NUMBER --reviewer ID --revision N Request review from current writers
  pr remove-reviewer NUMBER --reviewer ID --revision N Remove an outstanding request
  pr draft NUMBER                          Inspect this CLI credential's private review
  pr comment NUMBER --draft --revision N   Collect a private hunk comment (0 starts a draft)
  pr draft NUMBER --edit ID --revision N    Edit a private comment; --body TEXT required
  pr draft NUMBER --remove ID --revision N  Remove one private comment
  pr draft NUMBER --discard --revision N    Discard this credential's pending review
  pr review NUMBER --pending --revision N   Publish all pending comments with a verdict
  pr comment NUMBER --path FILE --line N   Inline feedback; --body TEXT [--side left|right]
  pr resolve NUMBER --thread ID            Resolve a conversation (--reopen to reopen)
  pr close NUMBER / pr merge NUMBER        Close or merge with all server protections
  pr merge NUMBER --merge|--squash|--rebase Choose generated history (otherwise use repository default)
  pr merge NUMBER --method METHOD          Explicit fast-forward, merge, squash or rebase
  pr merge NUMBER --squash --message TEXT   Custom merge/squash commit message
  run list [-R OWNER/REPO]                   List Actions runs (--web for deployment reviews)
  deployment list [--before N] [--limit N] List deployment requests and current gates
  deployment view REQUEST_ID               Inspect candidate, reviewers, timer and revision
  deployment request RUN_ID --environment NAME Request deployment with environment gates
  deployment approve REQUEST_ID --revision N Approve as a configured reviewer; --body TEXT
  deployment reject REQUEST_ID --revision N Reject and cancel the waiting deployment
  runner list                              List runner registrations (owner permission)
  runner create NAME --token-file FILE      Save a private CI credential and register it
  runner recover --token-file FILE          Recover the same registration after a lost response
  runner revoke ID --confirm ID             Revoke a runner and its active leases
  access list                              List collaborators, invitations and access revision
  access invite ACCOUNT --role ROLE        Invite with --invite-file FILE --revision N
  access recover --invite-file FILE        Recover the same invitation after a lost response
  access role ACCOUNT --role ROLE          Change access with --revision N
  access remove ACCOUNT --confirm ACCOUNT  Remove access with --revision N
  access cancel ID --confirm ID             Cancel a pending invitation with --revision N
  secret list [--environment NAME]          Inspect Cloudflare reference and grant metadata
  secret connect NAME --binding BINDING    Connect a reference with --revision N
  secret disconnect NAME --confirm NAME    Disconnect with --revision N; Cloudflare retains values
  secret grant NAMES --token-file FILE     Issue a private workload grant with --revision N [--ttl 60..3600]
  secret recover --token-file FILE         Recover the same grant without extending or reviving it
  secret revoke ID --confirm ID            Revoke one workload grant
  env list / env view ID / env export ID    Inspect deployment environments (admin permission)
  env create --file FILE                    Create from {revision,configuration}
  env update ID --file FILE                 Replace the complete exported environment
  env delete ID --revision N --confirm ID   Remove an environment (admin permission)
  rules view [-R OWNER/REPO]                 Open repository protection settings
  rules list [-R OWNER/REPO]                 List branch protections and their revision
  rules get PATTERN [-R OWNER/REPO]          Export one exact protection with its revision
  rules set --file FILE [-R OWNER/REPO]      Apply an edited protection export (admin permission)
  rules delete PATTERN --revision N         Remove an exact protection; --confirm PATTERN required
  ruleset list / ruleset view ID            Read rulesets (bypass accounts require admin permission)
  ruleset export ID --json                  Export complete ruleset and observed revision
  ruleset create --file FILE                Create from {revision,configuration} (admin permission)
  ruleset update ID --file FILE             Replace the complete exported configuration
  ruleset delete ID --revision N            Remove a ruleset; --confirm ID required
  auth login [-R OWNER/REPO]                 Authorize CLI access in your browser
  auth login --web [-R OWNER/REPO]           Open manual Git/API credential setup
  auth login -R OWNER/REPO --with-token      Read a Git token from stdin into a credential helper
  auth login -R OWNER/REPO --with-api-token  Read a CLI API credential from stdin
  auth status / auth logout                 Verify or revoke the CLI API credential
  auth status --git [-R OWNER/REPO]          Verify current Git read access
  auth logout --git [-R OWNER/REPO]          Remove this repository's local Git credential
  auth setup-git [-R OWNER/REPO]             Use the CLI credential in this checkout's Git

  -R, --repo OWNER/REPO    Infer from origin when omitted
  --host ORIGIN           Default: https://nanohub.sh (HTTP only on loopback)
  --trunk ID              Address an older workspace without an owner/repo alias
  --credential-helper H   osxkeychain, manager, libsecret or cache
  --print                 Print the browser URL instead of opening it
  --json                  Print structured output without opening a browser
  --web                   Open the signed-in browser for list/view commands
  --api                   Use CLI API credentials (the default for auth commands)
  --git                   Use separate Git credentials for auth, clone or import
  --no-browser            Show login instructions without opening a browser
  --scopes S1,S2          Request CLI permissions (read is always included)
  --days N                Requested CLI expiry: 1–30 days (default 7)
  --label NAME            Name the CLI credential in Git access

Browser login shows a short code; confirm it and the requested repository access.
The browser may reduce permissions and expiry. Values are saved in an OS helper.
Git tokens never authorize API commands. CLI Git access requires explicit
contents:read / contents:write permissions. Protection edits require an explicit
protections:write grant; ruleset edits/export require rulesets:write. Both require
your current repository admin role. Archive and unarchive require the separate
repository:archive permission; it remains available to admins while archived.
Default branch edits require repository:default and an active repository.
Merge-method edits require repository:merge, your current admin role and the
revision from repo merge-settings. Branch protections still apply to every merge.
Secret metadata requires secrets:read and your current admin role. Reference edits use
secrets:write; workload grants use secrets:grant. Values stay in Cloudflare. Grant
credentials are saved in owner-only files outside Git and stop with the issuing CLI credential.
Environment administration requires environments:write and your current admin role.
Deployment requests require deployments:write and current writer access.
Deployment reviews require deployments:review and current configured reviewer access;
read-only members can review. Self-review prevention and wait timers still apply.
Runner administration requires runners:write and your current owner role.
Collaborator administration requires collaborators:write and current admin access
in an independently managed repository. Only the owner can manage admins.
Issued runner credentials have an independent lifetime and last until revoked.
Private CLI drafts require reviews:write and current writer access. Each CLI
credential has its own draft; browser drafts stay separate. Stale diffs cannot
be submitted. Inspect pr draft after a lost response before repeating a write.
`;
async function protectionFile(path) {
 const handle=await open(path,'r');
 try{const bytes=Buffer.alloc(131073),{bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>131072)throw Error('Protection file exceeds 128 KiB');return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));}finally{await handle.close();}
}
export function processRun(command,args,{input='',cwd,env=process.env}={}) {
 return new Promise((done,reject)=>{
  const child=spawn(command,args,{cwd,env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
  child.stdout.on('data',chunk=>{stdout=(stdout+chunk).slice(-1048576);});child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1048576);});
  child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);done({code,stdout,stderr});});child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
const validRepo=value=>/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9][a-z0-9._-]{0,99}$/.test(value);
const validTrunk=value=>/^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
export function hostOrigin(value) {
 let url;try{url=new URL(value);}catch{throw Error('Use an absolute --host origin');}
 if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw Error('Use an HTTPS origin, or HTTP on loopback, without credentials or a path');
 return url.origin;
}
export function address(value,origin,trunk=false) {
 if(typeof value!=='string'||!(trunk?validTrunk(value):validRepo(value)))throw Error(trunk?'Use a valid workspace ID':'Use an owner/repo address');
 return {repository:trunk?null:value,trunk:trunk?value:null,origin,gitUrl:`${origin}/git/${value}.git`,url:trunk?`${origin}/t/${value}`:`${origin}/${value}`};
}
function options(args) {
 const values={},positionals=[];const names={'-R':'repo','--repo':'repo','--host':'host','--trunk':'trunk','--credential-helper':'helper',...Object.fromEntries(['title','body','head','base','verdict','path','side','line','start-line','reply-to','thread','scopes','days','label','file','revision','confirm','default-branch','token-file','invite-file','role','edit','remove','method','message','allow-merge-methods','default-merge-method','environment','before','limit','binding','ttl','reviewer'].map(k=>['--'+k,k]))};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--'){positionals.push(...args.slice(i+1));break;}
  const arg=args[i],equal=arg.indexOf('='),flag=equal>=0?arg.slice(0,equal):arg;if(names[flag]){if(values[names[flag]]!==undefined||equal<0&&(!args[i+1]||args[i+1].startsWith('-')))throw Error(`Provide one value for ${flag}`);values[names[flag]]=equal>=0?arg.slice(equal+1):args[++i];}
  else if(['--with-token','--with-api-token','--print','--json','--api','--git','--web','--reopen','--no-browser','--draft','--pending','--discard','--merge','--squash','--rebase'].includes(arg))values[arg.slice(2)]=true;
  else if(arg.startsWith('-'))throw Error(`Unknown option: ${arg}`);else positionals.push(arg);
 }
 if(values.repo&&values.trunk)throw Error('Choose --repo or --trunk');return{...values,positionals};
}
export async function run(args,{execute=processRun,write=console.log,progress=console.error,readProtectionFile=protectionFile,readToken=async()=>{if(process.stdin.isTTY)throw Error('Pipe one credential to the token login option');let value='';for await(const chunk of process.stdin){value+=chunk;if(value.length>1024)throw Error('Expected one credential on stdin');}return value;},readCredential=async()=>{if(process.stdin.isTTY)throw Error('Git invokes this credential helper through a pipe');let value='';for await(const chunk of process.stdin){value+=chunk;if(value.length>16384)throw Error('Git credential request is too large');}return value;},platform=process.platform,cwd=process.cwd(),fetcher=fetch,environment=process.env,wait,now}={}) {
 if(!args.length||args[0]==='--help'||args[0]==='help'){write(help);return;}
 if(args[0]==='--version'){write('nh '+cliPackage.version);return;}
 const [group,action,...rest]=args,allowed=new Set(['repo clone','repo import','repo view','repo default-branch','repo merge-settings','repo edit','repo archive-status','repo archive','repo unarchive','pr list','pr view','pr diff','pr create','pr review','pr reviewers','pr request-review','pr remove-reviewer','pr draft','pr comment','pr resolve','pr close','pr merge','run list','runner list','runner create','runner recover','runner revoke','env list','env view','env export','env create','env update','env delete','rules view','rules list','rules get','rules set','rules delete','ruleset list','ruleset view','ruleset export','ruleset create','ruleset update','ruleset delete','auth login','auth status','auth logout','auth setup-git','auth git-credential']);
 if(group==='secret')for(const verb of ['list','connect','disconnect','grant','recover','revoke'])allowed.add('secret '+verb);
 if(group==='deployment')for(const verb of ['list','view','request','approve','reject'])allowed.add('deployment '+verb);
 if(group==='access')for(const verb of ['list','invite','recover','role','remove','cancel'])allowed.add('access '+verb);
 if(!allowed.has(`${group} ${action}`))throw Error('Unknown command. Run nh --help');
 const opts=options(rest),pos=[...opts.positionals];let origin=hostOrigin(opts.host??'https://nanohub.sh'),target;
 const mergeFlags=['merge','squash','rebase'].filter(flag=>opts[flag]);
 if((mergeFlags.length||opts.method!==undefined||opts.message!==undefined)&&!(group==='pr'&&action==='merge'))throw Error('Merge method/message options only apply to pr merge');
 if(mergeFlags.length>1||mergeFlags.length&&opts.method!==undefined)throw Error('Choose one merge method');
 if(mergeFlags.length)opts.method=mergeFlags[0];
 if(opts.method!==undefined&&!['fast-forward','merge','squash','rebase'].includes(opts.method))throw Error('Choose fast-forward, merge, squash or rebase');
 if(opts.message!==undefined&&(!['merge','squash'].includes(opts.method)||!opts.message.trim()||opts.message.includes('\0')||new TextEncoder().encode(opts.message).length>65536))throw Error('--message requires merge/squash and nonempty text of at most 64 KiB without NUL');
 const helper=opts.helper??(platform==='darwin'?'osxkeychain':'manager');
 if(!['osxkeychain','manager','libsecret','cache'].includes(helper))throw Error('Choose an OS credential helper or the in-memory cache; plaintext storage is unsupported');
 const git=async(argv,input='',directory=cwd,selectedHelper=helper)=>{const gitArgs=['-c','credential.helper=','-c',`credential.helper=${selectedHelper}`,'-c','credential.useHttpPath=true'];const value=await execute('git',[...gitArgs,...argv],{cwd:directory,input,env:{...process.env,...environment,GIT_TERMINAL_PROMPT:'0'}});if(value.code!==0)throw Error(`Git ${argv[0]} failed. Check repository access and the ${helper} credential helper.`);return value.stdout;};
 if(opts['with-token']&&`${group} ${action}`!=='auth login')throw Error('--with-token is only valid for auth login');
 if(opts['with-api-token']&&`${group} ${action}`!=='auth login')throw Error('--with-api-token is only valid for auth login');
 if(opts['with-token']&&opts['with-api-token'])throw Error('Choose one credential type');
 if(opts.api&&group!=='auth')throw Error('--api is only needed for auth commands');
 const pendingMode=group==='pr'&&(action==='draft'||action==='comment'&&opts.draft||action==='review'&&opts.pending);
 if(opts.draft&&!(group==='pr'&&action==='comment')||opts.pending&&!(group==='pr'&&action==='review')||[opts.edit,opts.remove,opts.discard].some(v=>v!==undefined)&&!(group==='pr'&&action==='draft'))throw Error('Draft options only apply to pr draft, pr comment --draft or pr review --pending');
 if(pendingMode&&[opts['reply-to'],opts.thread,opts.reopen].some(v=>v!==undefined))throw Error('Pending reviews accept root hunk comments; replies and resolution use published threads');
 if([opts.file,opts.revision,opts.confirm].some(v=>v!==undefined)&&!(group==='pr'&&['request-review','remove-reviewer'].includes(action)&&opts.file===undefined&&opts.confirm===undefined||pendingMode&&opts.file===undefined&&opts.confirm===undefined||group==='rules'&&['set','delete'].includes(action)||['ruleset','env'].includes(group)&&['create','update','delete'].includes(action)||group==='repo'&&['archive-status','archive','unarchive','default-branch','merge-settings','edit'].includes(action)||group==='runner'&&action==='revoke'||group==='access'&&opts.file===undefined||group==='deployment'&&['approve','reject'].includes(action)&&opts.file===undefined&&opts.confirm===undefined||group==='secret'&&opts.file===undefined))throw Error('--file, --revision and --confirm only apply to rule edits, repository administration, deployment reviews or pending review revisions');
 if([opts['invite-file'],opts.role].some(value=>value!==undefined)&&group!=='access')throw Error('--invite-file and --role only apply to access commands');
 if(group==='access'&&(opts.web||opts.print||opts.file!==undefined))throw Error('Access administration uses native commands and --invite-file');
 if(opts['token-file']!==undefined&&!(group==='runner'&&['create','recover'].includes(action)||group==='secret'&&['grant','recover'].includes(action)))throw Error('--token-file only applies to runner create/recover or secret grant/recover');
 if(group==='runner'&&(opts.web||opts.print||opts.file!==undefined||opts.revision!==undefined))throw Error('Runner administration uses native runner commands and --token-file');
 if(opts.environment!==undefined&&!(group==='deployment'&&action==='request'||group==='secret')||[opts.before,opts.limit].some(value=>value!==undefined)&&!(group==='deployment'&&action==='list'))throw Error('--environment applies to deployment request or secret commands; --before and --limit apply to deployment list');
 if([opts.binding,opts.ttl].some(value=>value!==undefined)&&group!=='secret')throw Error('--binding and --ttl only apply to secret commands');
 if(group==='secret'&&(opts.web||opts.print||opts.file!==undefined))throw Error('Secret administration uses native commands and a private --token-file');
 if(opts.reviewer!==undefined&&!(group==='pr'&&['request-review','remove-reviewer'].includes(action)))throw Error('--reviewer only applies to request-review or remove-reviewer');
 if(group==='pr'&&['reviewers','request-review','remove-reviewer'].includes(action)&&(opts.web||opts.print))throw Error('Reviewer requests use native CLI commands');
 if(group==='env'&&(opts.web||opts.print))throw Error('Environment commands use the native API; use rules view for browser settings');
 if(group==='repo'&&['archive-status','archive','unarchive','default-branch','merge-settings','edit'].includes(action)&&(opts.web||opts.print))throw Error('Repository administration uses the native API; use repo view to open the repository');
 if(opts['default-branch']!==undefined&&!(group==='repo'&&action==='edit'))throw Error('--default-branch only applies to repo edit');
 if([opts['allow-merge-methods'],opts['default-merge-method']].some(value=>value!==undefined)&&!(group==='repo'&&action==='edit'))throw Error('Merge settings options only apply to repo edit');
 if(group==='ruleset'&&(opts.web||opts.print))throw Error('Ruleset commands use the native API; use rules view for browser settings');
 if(group==='rules'&&action!=='view'&&(opts.web||opts.print))throw Error('Use rules view to open protection settings in the browser');
 if(opts.git&&group!=='auth'&&!(group==='repo'&&['clone','import'].includes(action)))throw Error('--git only applies to auth commands, repo clone or repo import');
 if(opts.git&&(opts.api||opts['with-api-token']))throw Error('Choose Git or CLI API authentication');
 if(opts['with-token']&&opts.api)throw Error('--with-token supplies a Git credential; omit --api');
 if((opts.scopes||opts.days||opts.label||opts['no-browser'])&&`${group} ${action}`!=='auth login')throw Error('Login options only apply to auth login');
 if((opts['with-token']||opts['with-api-token'])&&(opts.scopes||opts.days||opts.label||opts['no-browser']))throw Error('Choose browser login options or a supplied credential');
 if((opts.web||opts.print)&&group==='pr'&&!['view','list'].includes(action))throw Error('--web and --print only support PR list/view');
 if(group==='repo'&&action==='clone'){
  if(opts.repo||opts.trunk)target=address(opts.repo??opts.trunk,origin,!!opts.trunk);else target=address(pos.shift(),origin);
 }else if(opts.repo||opts.trunk)target=address(opts.repo??opts.trunk,origin,!!opts.trunk);
 else {
  let remote;try{remote=new URL((await git(['remote','get-url','origin'])).trim());}catch{throw Error('Use -R owner/repo, --trunk ID, or run inside a Nanohub Git checkout');}
  if(remote.password||remote.username&&remote.username!=='git'||remote.search||remote.hash||remote.origin!==origin)throw Error('Origin must be a Nanohub Git URL on --host, without embedded credentials');
  const match=/^\/git\/(.+)\.git$/.exec(remote.pathname);if(!match)throw Error('Origin is not a Nanohub Git remote');target=address(match[1],origin,!match[1].includes('/'));
 }
 const output=value=>write(opts.json?JSON.stringify(value):value.message??value.url);
 if(group==='repo'&&action==='import')return importCommand({pos,opts,target,git,cwd,fetcher,environment,write,progress});
 if(group==='auth'&&action==='git-credential') {
  if(pos.length!==1||opts.json||opts.print||opts.web||opts.api||opts.git)throw Error('Git credential protocol expects one operation');
  return gitCredentialHelper({target,git,environment,readCredential,write,operation:pos[0]});
 }
 if(group==='auth'&&action==='setup-git') {
  if(pos.length||opts.git)throw Error('Use auth setup-git inside the matching checkout');
  let remote;try{remote=new URL((await git(['remote','get-url','origin'])).trim());}catch{throw Error('Run auth setup-git inside the matching Nanohub checkout');}
  if(remote.password||remote.username&&remote.username!=='git'||remote.search||remote.hash||remote.origin!==target.origin||remote.pathname!==new URL(target.gitUrl).pathname)throw Error('Origin must match the selected repository before changing local Git settings');
  await requireGitAccess(target,git,environment,fetcher);
  await configureGitHelper(git,cwd,gitHelperCommand(target,helper),{cli:true});
  output({...target,gitConfigured:true,message:`Git now uses the scoped CLI credential in this checkout.${environment.NANOHUB_API_TOKEN?' Keep NANOHUB_API_TOKEN available for Git operations.':''}`});return;
 }
 if(group==='auth'&&action==='login'&&!opts['with-token']&&!opts['with-api-token']&&!opts.web&&!opts.print&&!opts.git)return browserLogin({target,opts,pos,git,execute,write,progress,platform,cwd,fetcher,environment,wait,now});
 if(group==='auth'&&(opts['with-api-token']||!opts.git&&action!=='login')||group==='pr'&&!opts.web&&!opts.print||group==='run'&&!opts.web&&!opts.print||group==='rules'&&action!=='view'||['ruleset','env','runner','access','deployment','secret'].includes(group)||group==='repo'&&['archive-status','archive','unarchive','default-branch','merge-settings','edit'].includes(action))return nativeCommand({group,action,pos,opts,target,git,readToken,readProtectionFile:path=>readProtectionFile(resolve(cwd,path)),write,fetcher,environment,cwd});
 if(group==='repo'&&action==='clone'){
  if(pos.length>1)throw Error('Use at most one destination directory');const directory=pos[0]??basename(target.repository??target.trunk);if(!directory||directory.startsWith('-'))throw Error('Use a destination directory that does not start with a dash');
  let selectedHelper=helper,cli=false;
  if(!opts.git) {const token=await storedApiToken(target,git,environment);if(token){await requireGitAccess(target,git,environment,fetcher,token);selectedHelper=gitHelperCommand(target,helper);cli=true;}}
  await git([...(cli?['-c','http.followRedirects=false']:[]),'clone','--',target.gitUrl,directory],'',cwd,selectedHelper);const local=resolve(cwd,directory);await configureGitHelper(git,local,selectedHelper,{cli});output({...target,directory:local,message:`Cloned ${target.repository??target.trunk} into ${local}`});return;
 }
 let path='';
 if(group==='pr'&&action==='view'){const number=pos.shift();if(!/^[1-9]\d{0,8}$/.test(number??''))throw Error('Choose a positive pull request number');path=`/pulls/${number}`;}
 if(pos.length)throw Error('Unexpected positional argument');
 if(group==='auth'&&action!=='login'||group==='auth'&&opts['with-token']) {
  const url=new URL(target.gitUrl),credential=`protocol=${url.protocol.slice(0,-1)}\nhost=${url.host}\npath=${url.pathname.slice(1)}\nusername=git\n`;
  if(action==='login'){
   const token=(await readToken()).trim();if(!/^nhg_[a-f0-9]{48}$/.test(token))throw Error('Expected one repository-scoped nhg_ Git token on stdin');
   // Verify before storing. The temporary helper supplies the token through an
   // environment variable, never a command argument, URL, or on-disk config.
   const verify=await execute('git',['-c','credential.helper=','-c','credential.helper=!f() { p= h= t=; while IFS= read -r line && test -n "$line"; do case "$line" in protocol=*) p=${line#protocol=};; host=*) h=${line#host=};; path=*) t=${line#path=};; esac; done; if test "$1" = get && test "$p" = "$NANOHUB_VERIFY_PROTOCOL" && test "$h" = "$NANOHUB_VERIFY_HOST" && test "$t" = "$NANOHUB_VERIFY_PATH"; then printf "username=git\\npassword=%s\\n" "$NANOHUB_VERIFY_TOKEN"; fi; }; f','-c','credential.useHttpPath=true','ls-remote','--',target.gitUrl],{cwd,env:{...process.env,GIT_TERMINAL_PROMPT:'0',NANOHUB_VERIFY_TOKEN:token,NANOHUB_VERIFY_PROTOCOL:url.protocol.slice(0,-1),NANOHUB_VERIFY_HOST:url.host,NANOHUB_VERIFY_PATH:url.pathname.slice(1)}});
   if(verify.code!==0)throw Error('Git token could not read this repository; nothing was stored');await git(['credential','approve'],`${credential}password=${token}\n\n`);const stored=await git(['credential','fill'],credential+'\n');if(!stored.split('\n').includes(`password=${token}`))throw Error('The credential helper did not retain this repository token');output({...target,message:`Git credential saved using ${helper}. Its repository scope and expiry are unchanged.`});return;
  }
  if(action==='logout'){await git(['credential','reject'],credential+'\n');output({...target,message:'Local Git credential removed. Revoke the server token in repository Git access settings.'});return;}
  await git(['ls-remote','--',target.gitUrl]);output({...target,authenticated:true,message:'Git read access confirmed. Token expiry and repository membership remain enforced by the server.'});return;
 }
 if(group==='pr'&&action==='list')path='/pulls';if(group==='run')path='/actions';if(group==='rules')path='/settings/rules';if(group==='auth')path='/connect';
 const url=target.url+path;if(opts.print||opts.json){output({...target,url});return;}
 const program=platform==='darwin'?'open':platform==='win32'?'rundll32':'xdg-open',argv=platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
 const opened=await execute(program,argv,{cwd});if(opened.code!==0)throw Error(`Could not open a browser. Use --print to get the URL.`);output({...target,url,message:`Opened ${url}`});
}
