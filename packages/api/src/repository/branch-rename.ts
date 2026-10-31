import {createHash} from 'node:crypto';
import {Repository} from './store';
import {Policies} from './policy';
import {Rulesets,applies} from './rulesets';
import {rulesetBypass,currentRulesetActor,type RulesetActor} from './bypass';
import {metadataMatcher} from './metadata-pattern';
import {branchName,newRefName} from './ref-name';
import {assertRepositoryWritable,ArchiveStore} from './archive';
import {CIStore} from '../ci/store';
import {branchFingerprint} from '../signing/ref-proof';
import type {Pull} from '../review/types';
import type {RefProof} from './types';
import type {Ruleset,RulesetInput} from './ruleset-types';
import type {BranchRenameInput,BranchRenameConfiguration,BranchRenamePreview} from './branch-rename-types';

/** All writes run in the sequencer transaction. Storage triggers also fence
 * older code's ref/PR writes, including ABA changes and identical SQL updates. */
export class BranchRenames {
 constructor(private sql:SqlStorage){
  new Repository(sql);
  sql.exec('CREATE TABLE IF NOT EXISTS review_pulls (number INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS repository_branch_renames (old_name TEXT PRIMARY KEY,new_name TEXT NOT NULL,at INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS branch_rename_revision (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,generation TEXT NOT NULL)');
  sql.exec('INSERT OR IGNORE INTO branch_rename_revision VALUES (1,0,?)',crypto.randomUUID());
  const tables=['repository_refs','review_pulls','repository_branch_renames'],events=['insert','update','delete'];
  const names=tables.flatMap(table=>events.map(event=>'branch_rename_'+table+'_'+event));
  const installed=sql.exec<{n:number}>("SELECT count(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN (SELECT value FROM json_each(?))",JSON.stringify(names)).toArray()[0].n;
  if(installed!==names.length){
   sql.exec('UPDATE branch_rename_revision SET revision=revision+1 WHERE id=1');
   for(const table of tables)for(const event of events)sql.exec(`CREATE TRIGGER IF NOT EXISTS branch_rename_${table}_${event} AFTER ${event.toUpperCase()} ON ${table} BEGIN UPDATE branch_rename_revision SET revision=revision+1 WHERE id=1; END`);
  }
 }
 configuration():BranchRenameConfiguration {
  const repo=new Repository(this.sql),policies=new Policies(this.sql),rules=new Rulesets(this.sql).plan();
  const ledger=this.sql.exec<{revision:number;generation:string}>('SELECT revision,generation FROM branch_rename_revision WHERE id=1').toArray()[0];
  if(!ledger||!Number.isSafeInteger(ledger.revision)||ledger.revision<0||typeof ledger.generation!=='string'||!ledger.generation)throw Error('Branch rename revision authority is unavailable');
  const revision=createHash('sha256').update(JSON.stringify({ledger,settings:repo.configuration().revision,policies:policies.revision(),rules:rules.revision,archive:new ArchiveStore(this.sql).state()})).digest('hex');
  return {protocol:1,mode:repo.mode()?'git':'snapshot',defaultBranch:repo.defaultBranch(),revision,conditionalWrites:true,revisionTracking:'storage',cliAudit:true,branches:repo.refs().filter(ref=>ref.name.startsWith('refs/heads/')).map(ref=>({...ref,name:ref.name.slice(11)}))};
 }
 private pulls(){return this.sql.exec<{number:number;data:string}>('SELECT number,data FROM review_pulls ORDER BY number').toArray().map(row=>({...JSON.parse(row.data),number:row.number}) as Pull);}
 private rules(from:string,to:string):{previous:Ruleset;next:RulesetInput}[]{
  const plan=new Rulesets(this.sql).plan(),fromRef='refs/heads/'+from,toRef='refs/heads/'+to,nextDefault=from===plan.defaultBranch?to:plan.defaultBranch;
  return plan.rulesets.filter(rule=>rule.target==='branch'&&applies({...rule,enforcement:'active'},fromRef,plan.defaultBranch)).flatMap(previous=>{
   const {id,...input}=previous,conditions=input.conditions!.ref_name;
   const include=conditions.include.map(pattern=>pattern===fromRef?toRef:pattern);
   let next={...input,conditions:{ref_name:{...conditions,include}}};
   if(!applies({...next,id,enforcement:'active'},toRef,nextDefault)){
    // Do not remove an exclusion that intentionally protects a different scope.
    const withoutExclusions={...next,id,enforcement:'active' as const,conditions:{ref_name:{include:[toRef],exclude:[]}}};
    if(applies({...withoutExclusions,conditions:{ref_name:{include:[toRef],exclude:conditions.exclude}}},toRef,nextDefault))next={...next,conditions:{ref_name:{...conditions,include:[...new Set([...include,toRef])]}}};
    else throw Error('The destination is excluded by source ruleset "'+previous.name+'"; explicitly reconcile that ruleset before renaming');
   }
   return JSON.stringify(next)===JSON.stringify(input)?[]:[{previous,next}];
  });
 }
 preview(from:string,to:string):BranchRenamePreview {
  branchName(from);branchName(to);newRefName('refs/heads/'+to);
  const state=this.configuration();if(state.mode!=='git')throw Error('Branch renaming requires Git repository mode');
  if(from===to)throw Error('Choose a different branch name');
  const source=state.branches.find(branch=>branch.name===from);if(!source)throw Error('Source branch is unavailable; inspect branches again');
  const remaining=new Repository(this.sql).refs().filter(ref=>ref.name!=='refs/heads/'+from),destination='refs/heads/'+to;
  if(remaining.some(ref=>ref.name===destination||ref.name.startsWith(destination+'/')||destination.startsWith(ref.name+'/')))throw Error('Destination branch already exists or conflicts with another ref');
  const policies=new Policies(this.sql),plan=new Rulesets(this.sql).plan(),pulls=this.pulls().filter(p=>p.state==='open');
  const protectedBranch=(name:string)=>!!policies.get(name)||plan.rulesets.some(rule=>rule.target==='branch'&&applies({...rule,enforcement:'active'},'refs/heads/'+name,state.defaultBranch));
  return {from,to,commit:source.commit,revision:state.revision,defaultBranch:from===state.defaultBranch,requiresAdmin:from===state.defaultBranch||protectedBranch(from)||protectedBranch(to),
   retargetedPulls:pulls.filter(p=>p.base===from&&p.head!==from).map(p=>p.number),closedPulls:pulls.filter(p=>p.head===from).map(p=>p.number),
   protectionFollows:!!policies.get(from)||plan.rulesets.some(rule=>rule.target==='branch'&&rule.enforcement!=='disabled'&&applies({...rule,enforcement:'active'},'refs/heads/'+from,state.defaultBranch)),updatedRulesets:this.rules(from,to).map(change=>change.previous.id)};
 }
 rename(input:BranchRenameInput,actor:string,authority:RulesetActor,proof:RefProof,sourceProof:RefProof,human:boolean,via?:{kind:'cli';credentialId:string}){
  assertRepositoryWritable(this.sql);
  if(!currentRulesetActor(authority,actor)||!['owner','admin','writer'].includes(authority.role??''))throw Error('Current repository write membership is required to rename branches');
  if(!input||typeof input.revision!=='string'||!/^[a-f0-9]{64}$/.test(input.revision)||!/^[a-f0-9]{40}$/.test(input.commit))throw Error('Use the observed branch commit and rename revision');
  const configuration=this.configuration();if(configuration.revision!==input.revision)return {conflict:true as const,revision:configuration.revision};
  const preview=this.preview(input.from,input.to),repo=new Repository(this.sql,undefined,authority),refs=repo.refs(),source=refs.find(ref=>ref.name==='refs/heads/'+input.from)!;
  if(preview.commit!==input.commit)throw Error('Source branch changed; inspect branches before renaming');
  if(preview.requiresAdmin&&!['owner','admin'].includes(authority.role??''))throw Error('Current repository admin access is required to rename default or protected branches');
  const policies=new Policies(this.sql),rules=new Rulesets(this.sql),plan=rules.plan(),fromRef='refs/heads/'+input.from,toRef='refs/heads/'+input.to;
  if(policies.get(input.from)?.locked||policies.get(input.to)?.locked)throw Error('Branch is locked; unlock it explicitly before renaming');
  const matching=plan.rulesets.filter(rule=>rule.target==='branch'&&applies({...rule,enforcement:'active'},fromRef,configuration.defaultBranch));
  const metadata=metadataMatcher();
  for(const rule of matching){
   if(rule.enforcement!=='active'||rulesetBypass(rule,actor,human,false,authority))continue;
   if(rule.rules.some(item=>item.type==='creation'))throw Error('Source ruleset "'+rule.name+'" restricts creation; rename requires its explicit bypass permission');
   for(const item of rule.rules)if(item.type==='branch_name_pattern'&&!metadata(item.parameters,input.to))throw Error('The new name violates source ruleset "'+rule.name+'"');
  }
  const base=repo.main().commit;
  // Renaming does not delete content or introduce new source history. It still
  // observes locks, allowed actors, graph/deployment guards and ref rulesets.
  policies.restrictions(input.from,actor,false,input.commit,input.commit,sourceProof,base);
  const bypassedRulesets=rules.enforce(fromRef,input.commit,null,false,actor,human,false,undefined,branchFingerprint(refs),undefined,base,authority);
  const sourcePushId=policies.pushEvent(input.from),sourcePush=sourcePushId?this.sql.exec<{data:string}>('SELECT data FROM repository_audit WHERE id=?',sourcePushId).toArray()[0]:undefined;
  const changes=this.rules(input.from,input.to),carried=policies.combined(input.to,[input.from,input.to]);
  // Removing the old row inside this same transaction also permits foo ->
  // foo/bar. No reader observes a missing default or a half-completed rename.
  this.sql.exec('DELETE FROM repository_refs WHERE name=?',fromRef);
  // Existing destination protections are checked before source policy moves.
  repo.update(toRef,null,{commit:source.commit,tree:source.tree},true,actor,false,proof,human,branchFingerprint(refs),base,true);
  if(sourcePush){
   const original=JSON.parse(sourcePush.data);
   if(typeof original.actor==='string'&&original.actor)repo.audit({actor:original.actor,ref:toRef,old:original.old??null,next:source.commit,reviewable:true,human:original.human===true,
    forwardedPush:{sourceEvent:sourcePushId,sourceRef:fromRef,renamedBy:actor}});
  }
  const at=Date.now(),retargeted:number[]=[],closed:number[]=[];
  for(const pull of this.pulls().filter(p=>p.state==='open')){
   if(pull.head===input.from){pull.state='closed';pull.headCommit=source.commit;pull.headTree=source.tree;closed.push(pull.number);}
   else if(pull.base===input.from){pull.base=input.to;retargeted.push(pull.number);}
   else continue;
   pull.updatedAt=at;this.sql.exec('UPDATE review_pulls SET data=? WHERE number=?',JSON.stringify(pull),pull.number);
  }
  if(carried&&policies.get(input.from)){
   const previousPolicy=policies.list().find(policy=>policy.branch===input.to)??null;
   policies.set(carried);repo.audit({actor,policy:policies.list().find(policy=>policy.branch===input.to),previousPolicy,...(via?{via}:{})});
   const previous=policies.list().find(policy=>policy.branch===input.from);
   if(previous){policies.remove(input.from);repo.audit({actor,removedPolicy:input.from,previousPolicy:previous,...(via?{via}:{})});}
  }
  for(const change of changes){const ruleset=rules.set(change.next,change.previous.id);repo.audit({actor,ruleset,previousRuleset:change.previous,...(via?{via}:{})});}
  if(preview.defaultBranch){const selected=repo.selectDefault(input.to,source.commit,repo.configuration().revision,actor,via);if('conflict' in selected)throw Error('Default branch changed during rename');}
  const ci=new CIStore(this.sql);ci.supersede(input.from,null);ci.supersede(input.to,null);ci.enqueue(input.to,source.commit,repo.main().commit,actor);
  this.sql.exec('DELETE FROM repository_branch_renames WHERE old_name=?',input.to);
  if(!this.sql.exec('SELECT 1 FROM repository_branch_renames WHERE old_name=?',input.from).toArray().length&&this.sql.exec<{n:number}>('SELECT count(*) AS n FROM repository_branch_renames').toArray()[0].n>=10000)throw Error('Branch redirect limit reached');
  this.sql.exec('UPDATE repository_branch_renames SET new_name=? WHERE new_name=?',input.to,input.from);
  this.sql.exec('INSERT INTO repository_branch_renames VALUES (?,?,?) ON CONFLICT(old_name) DO UPDATE SET new_name=excluded.new_name,at=excluded.at',input.from,input.to,at);
  repo.audit({actor,ref:toRef,old:source.commit,next:source.commit,reviewable:false,human,
   ...(bypassedRulesets.length?{bypassedRulesets,bypassRole:{role:authority.role,checkedAt:authority.checkedAt}}:{}),
   branchRename:{from:input.from,to:input.to,commit:source.commit,defaultBranch:preview.defaultBranch,retargetedPulls:retargeted,closedPulls:closed,updatedRulesets:changes.map(change=>change.previous.id)},...(via?{via}:{})});
  return {...this.configuration(),renamed:{from:input.from,to:input.to,commit:source.commit,retargetedPulls:retargeted,closedPulls:closed}};
 }
 resolve(name:string){
  branchName(name);const repo=new Repository(this.sql),refs=repo.refs();
  if(refs.some(ref=>ref.name==='refs/heads/'+name))return name;
  const alias=this.sql.exec<{new_name:string}>('SELECT new_name FROM repository_branch_renames WHERE old_name=?',name).toArray()[0];
  return alias&&refs.some(ref=>ref.name==='refs/heads/'+alias.new_name)?alias.new_name:null;
 }
}
