import {assertRepositoryWritable} from "../repository/archive";
import {verifyDeploymentAuthorization} from "./authorization";
import {deploymentRefPolicy,requireDeploymentRef,deploymentRefError} from './ref-policy';
import {runRef,runRefTarget} from '../ci/ref';
import type {DeploymentMembership} from "./approval-types";
import type {DeploymentEnvironment,EnvironmentInput,DeploymentReport,DeploymentRecord,DeploymentGate} from './types';
const validName=(name:unknown):name is string=>typeof name==='string'&&name.length>0&&name.length<=255&&name===name.trim()&&!/[\x00-\x1f\x7f]/.test(name);
const key=(name:string)=>name.toLowerCase();
export function environmentNames(value:unknown,limit=30):string[] {
 if(!Array.isArray(value)||value.length>3000||value.some(name=>!validName(name)))throw Error('Choose up to 30 environment names, 1–255 characters each');
 const names=[...new Map((value as string[]).map(name=>[key(name),name])).values()];if(names.length>limit)throw Error(`Choose up to ${limit} environment names`);return names;
}
export class Environments {
 constructor(private sql:SqlStorage) {
  sql.exec('CREATE TABLE IF NOT EXISTS deployment_environments (id TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS deployment_environments_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)');
  sql.exec('INSERT OR IGNORE INTO deployment_environments_revision VALUES(1,0)');
  const installed=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('deployment_environment_revision_insert','deployment_environment_revision_update','deployment_environment_revision_delete')").toArray()[0].n;
  if(installed!==3){
   if(sql.exec('SELECT 1 FROM deployment_environments LIMIT 1').toArray().length)sql.exec('UPDATE deployment_environments_revision SET revision=revision+1 WHERE id=1');
   for(const [kind,when]of [['insert','INSERT'],['update','UPDATE OF name_key,data'],['delete','DELETE']])sql.exec(`CREATE TRIGGER IF NOT EXISTS deployment_environment_revision_${kind} AFTER ${when} ON deployment_environments BEGIN UPDATE deployment_environments_revision SET revision=revision+1 WHERE id=1; END`);
  }
  sql.exec('CREATE TABLE IF NOT EXISTS deployment_records (id INTEGER PRIMARY KEY AUTOINCREMENT, environment TEXT NOT NULL, head TEXT NOT NULL, base TEXT NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS deployment_candidate ON deployment_records(environment,head,base,id DESC)');
 }
 list():DeploymentEnvironment[]{return this.sql.exec<{data:string}>('SELECT data FROM deployment_environments ORDER BY name_key').toArray().map(r=>JSON.parse(r.data));}
 configuration(){return {revision:this.sql.exec<{revision:number}>('SELECT revision FROM deployment_environments_revision WHERE id=1').toArray()[0].revision,environments:this.list(),conditionalWrites:true as const,cliAudit:true as const,revisionTracking:'storage' as const};}
 find(name:string):DeploymentEnvironment|undefined {if(!validName(name))return;const row=this.sql.exec<{data:string}>('SELECT data FROM deployment_environments WHERE name_key=?',key(name)).toArray()[0];return row?JSON.parse(row.data):undefined;}
 private source(id:string) {
  if(!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ci_runners'").toArray().length)return;
  return this.sql.exec<{id:string;name:string;revoked:number}>('SELECT id,name,revoked FROM ci_runners WHERE id=?',id).toArray()[0];
 }
 resolve(names:unknown){return environmentNames(names).map(name=>{const env=this.find(name);if(!env)throw Error(`Unknown deployment environment: ${name}`);return env.name;});}
 set(input:EnvironmentInput,id?:string) {
  assertRepositoryWritable(this.sql);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['name','runner','reviewers','preventSelfReview','waitTimerMinutes','deploymentBranchPolicy'].includes(k))||!validName(input.name)||input.runner!==undefined&&(typeof input.runner!=='string'||!this.source(input.runner)||this.source(input.runner)!.revoked))throw Error('Use an environment name and an active repository runner source');
  if(input.reviewers!==undefined&&(!Array.isArray(input.reviewers)||input.reviewers.length>6||input.reviewers.some(id=>typeof id!=='string'||!id||id.length>256||/[\0\r\n]/.test(id)))||input.preventSelfReview!==undefined&&typeof input.preventSelfReview!=='boolean'||input.waitTimerMinutes!==undefined&&(!Number.isSafeInteger(input.waitTimerMinutes)||input.waitTimerMinutes<0||input.waitTimerMinutes>43200))throw Error('Choose up to six reviewers and a wait timer from 0 to 43,200 minutes');
  const reviewers=[...new Set(input.reviewers??[])],preventSelfReview=input.preventSelfReview??false,waitTimerMinutes=input.waitTimerMinutes??0;
  const refPolicy=deploymentRefPolicy(input.deploymentBranchPolicy);
  const existing=id?this.list().find(e=>e.id===id):undefined;
  if(id&&!existing)throw Error('Deployment environment not found');
  if(existing&&key(existing.name)!==key(input.name))throw Error('Environment names cannot be changed; create a new environment and update requirements explicitly');
  if(!existing&&this.list().length>=100)throw Error('At most 100 deployment environments');
  if(!existing&&this.find(input.name))throw Error('Deployment environment already exists (names are case-insensitive)');
  if(existing&&existing.name===input.name&&existing.runner===input.runner&&JSON.stringify(existing.reviewers??[])===JSON.stringify(reviewers)&&(existing.preventSelfReview??false)===preventSelfReview&&(existing.waitTimerMinutes??0)===waitTimerMinutes&&JSON.stringify(existing.deploymentBranchPolicy)===JSON.stringify(refPolicy))return existing;
  const now=Date.now(),env:DeploymentEnvironment={id:existing?.id??crypto.randomUUID(),name:input.name,revision:(existing?.revision??0)+1,createdAt:existing?.createdAt??now,updatedAt:now,...(reviewers.length?{reviewers}:{}),...(preventSelfReview?{preventSelfReview}:{}),...(waitTimerMinutes?{waitTimerMinutes}:{}),...(input.runner?{runner:input.runner}:{}),...(refPolicy?{deploymentBranchPolicy:refPolicy}:{})};
  this.sql.exec('INSERT INTO deployment_environments VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',env.id,key(env.name),JSON.stringify(env));return env;
 }
 remove(id:string){assertRepositoryWritable(this.sql);if(!this.list().some(e=>e.id===id))throw Error('Deployment environment not found');this.sql.exec('DELETE FROM deployment_environments WHERE id=?',id);}
 record(reports:DeploymentReport[],run:{id:string;head:string;base:string;attempt:number;createdAt:number;generation?:number;branch:string;ref?:string;refTarget?:string},runner:string,now=Date.now(),membership?:DeploymentMembership):DeploymentRecord[] {
  assertRepositoryWritable(this.sql);
  const source=this.source(runner);if(!source||source.revoked)throw Error('Deployment reporter is unavailable or revoked');
  const records=reports.map(report=>{
   if(!report||typeof report!=='object'||Array.isArray(report)||Object.keys(report).some(k=>!['environment','head','base','state','deploymentId','url','verifiedAt','authorizationId'].includes(k))||!validName(report.environment)||report.head!==run.head||report.base!==run.base||!['success','failure','cancelled'].includes(report.state)||typeof report.deploymentId!=='string'||!report.deploymentId.trim()||report.deploymentId.length>256||/[\x00-\x1f\x7f]/.test(report.deploymentId)||typeof report.url!=='string'||report.url.length>2048||!Number.isSafeInteger(report.verifiedAt)||report.verifiedAt<run.createdAt||report.verifiedAt>now+30000)throw Error('Deployment report must identify this exact candidate, environment and deployment');
   let url:URL;try{url=new URL(report.url);}catch{throw Error('Deployment URL must be HTTP or HTTPS');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Deployment URL must be HTTP or HTTPS without embedded credentials');
   const environment=this.find(report.environment);if(!environment)throw Error(`Unknown deployment environment: ${report.environment}`);
   requireDeploymentRef(this.sql,environment,runRef(run));
   if(report.verifiedAt<environment.updatedAt)throw Error(`Deployment environment ${environment.name} changed; deploy this candidate again`);
   if(environment.runner&&environment.runner!==runner)throw Error(`Deployment environment ${environment.name} requires its configured runner source`);
   verifyDeploymentAuthorization(this.sql,environment,report,run,runner,membership,now);
   return {...report,environment:environment.name,environmentId:environment.id,environmentRevision:environment.revision,runner,run:run.id,attempt:run.attempt,ref:runRef(run),refTarget:runRefTarget(run),at:now};
  });
  return records.map(record=>{this.sql.exec('INSERT INTO deployment_records(environment,head,base,data) VALUES (?,?,?,?)',record.environmentId,record.head,record.base,JSON.stringify(record));return {...record,id:this.sql.exec<{id:number}>('SELECT last_insert_rowid() AS id').toArray()[0].id};});
 }
 gate(names:string[],head:string,base:string):DeploymentGate {
  const required=environmentNames(names,100),environments=required.map(name=>{
   const env=this.find(name);let error:string|null=null,record:DeploymentRecord|null=null;
   if(!env)error=`Required deployment environment ${name} is unavailable`;
   else {
    const row=this.sql.exec<{id:number;data:string}>('SELECT id,data FROM deployment_records WHERE environment=? AND head=? AND base=? ORDER BY id DESC LIMIT 1',env.id,head,base).toArray()[0];
    record=row?{...JSON.parse(row.data),id:row.id}:null;
    const source=record?this.source(record.runner):undefined;
    const refError=record&&record.environmentRevision===env.revision?deploymentRefError(this.sql,env,record.ref):null;
    if(env.runner&&(!this.source(env.runner)||this.source(env.runner)!.revoked))error=`Deployment environment ${env.name} expects an unavailable or revoked runner source`;
    else if(!record)error=`Required deployment to ${env.name} has not succeeded for this candidate and base`;
    else if(record.environmentRevision!==env.revision)error=`Deployment environment ${env.name} changed; deploy this candidate again`;
    else if(refError)error=refError;
    else if(!source||source.revoked||env.runner&&record.runner!==env.runner)error=`Deployment to ${env.name} was reported by an unavailable or unexpected runner source`;
    else if(record.state!=='success')error=`Required deployment to ${env.name} is ${record.state}`;
   }
   return {name:env?.name??name,ready:!error,error,deployment:record};
  });return {required,environments,ready:environments.every(e=>e.ready)};
 }
 require(names:string[],head:string,base:string) {const gate=this.gate(names,head,base),failed=gate.environments.find(e=>!e.ready);if(failed)throw Error(failed.error!);return gate;}
}
