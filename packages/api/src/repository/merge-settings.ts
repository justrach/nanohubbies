import type {MergeMethod} from '../review/merge-types';
import {assertRepositoryWritable} from './archive';
import type {MergeSettings,MergeSettingsInput} from './merge-settings-types';
export type {MergeSettings,MergeSettingsInput} from './merge-settings-types';

export const mergeMethods=['fast-forward','merge','squash','rebase'] as const;
export function normalizeMergeSettings(input:MergeSettingsInput):MergeSettingsInput {
 if(!input||!Array.isArray(input.allowedMethods)||!input.allowedMethods.length||input.allowedMethods.length>4||
    new Set(input.allowedMethods).size!==input.allowedMethods.length||input.allowedMethods.some(method=>!mergeMethods.includes(method))||
    !input.allowedMethods.includes(input.defaultMethod))throw Error('Choose at least one valid merge method and an allowed default method');
 return {allowedMethods:mergeMethods.filter(method=>input.allowedMethods.includes(method)),defaultMethod:input.defaultMethod};
}

/** Separate storage revision: changing merge options never changes Git refs or
 * weakens branch rules. Final merges read this inside the serialized writer. */
export class MergeSettingsStore {
 constructor(private sql:SqlStorage) {
  sql.exec('CREATE TABLE IF NOT EXISTS repository_merge_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL)');
  sql.exec('INSERT OR IGNORE INTO repository_merge_revision VALUES (1,0)');
  sql.exec('CREATE TABLE IF NOT EXISTS repository_merge_settings (id INTEGER PRIMARY KEY CHECK(id=1), allowed_methods TEXT NOT NULL, default_method TEXT NOT NULL)');
  const existing=sql.exec('SELECT 1 FROM repository_merge_settings WHERE id=1').toArray().length>0;
  if(!existing&&this.revision()===0)sql.exec('INSERT INTO repository_merge_settings VALUES (1,?,?)',JSON.stringify(mergeMethods),'fast-forward');
  const installed=sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('repository_merge_update','repository_merge_delete','repository_merge_insert')").toArray()[0].n;
  if(installed!==3) {
   if(existing)sql.exec('UPDATE repository_merge_revision SET revision=revision+1 WHERE id=1');
   const bump='UPDATE repository_merge_revision SET revision=revision+1 WHERE id=1;';
   sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_merge_update AFTER UPDATE OF allowed_methods,default_method ON repository_merge_settings WHEN OLD.allowed_methods IS NOT NEW.allowed_methods OR OLD.default_method IS NOT NEW.default_method BEGIN ${bump} END`);
   sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_merge_delete AFTER DELETE ON repository_merge_settings BEGIN ${bump} END`);
   sql.exec(`CREATE TRIGGER IF NOT EXISTS repository_merge_insert AFTER INSERT ON repository_merge_settings WHEN (SELECT revision FROM repository_merge_revision WHERE id=1)>0 BEGIN ${bump} END`);
  }
 }
 private revision(){const value=this.sql.exec<{revision:number}>('SELECT revision FROM repository_merge_revision WHERE id=1').toArray()[0]?.revision;if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('Repository merge settings revision is unavailable; keep merges closed');return value;}
 get():MergeSettings {
  const row=this.sql.exec<{allowed_methods:string;default_method:MergeMethod}>('SELECT allowed_methods,default_method FROM repository_merge_settings WHERE id=1').toArray()[0];
  if(!row)throw Error('Repository merge settings are unavailable; keep merges closed');
  return {...normalizeMergeSettings({allowedMethods:JSON.parse(row.allowed_methods),defaultMethod:row.default_method}),revision:this.revision()};
 }
 require(method:MergeMethod,revision?:number) {
  const current=this.get();
  if(!current.allowedMethods.includes(method))throw Error('The selected merge method is disabled for this repository');
  if(revision!==undefined&&revision!==current.revision||revision===undefined&&current.revision>0)
   throw Error('Merge settings changed; refresh the pull request before merging');
 }
 set(input:MergeSettingsInput,revision:number,actor:string,via?:{kind:'cli';credentialId:string}) {
  assertRepositoryWritable(this.sql);
  if(!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_config'").toArray().length||!this.sql.exec('SELECT 1 FROM repository_config').toArray().length)
   throw Error('Merge settings require Git repository mode');
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Use the observed merge settings revision');
  const value=normalizeMergeSettings(input),current=this.get();
  if(revision!==current.revision)return {conflict:true as const,...current};
  if(JSON.stringify(value.allowedMethods)===JSON.stringify(current.allowedMethods)&&value.defaultMethod===current.defaultMethod)return current;
  this.sql.exec('UPDATE repository_merge_settings SET allowed_methods=?,default_method=? WHERE id=1',JSON.stringify(value.allowedMethods),value.defaultMethod);
  const next=this.get();
  this.sql.exec('INSERT INTO repository_audit (data) VALUES (?)',JSON.stringify({actor,at:Date.now(),mergeSettings:{previous:current,next},...(via?{via}:{})}));
  return next;
 }
}
