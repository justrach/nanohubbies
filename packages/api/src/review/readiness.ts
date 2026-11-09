import {assertRepositoryWritable} from '../repository/archive';
import {Repository} from '../repository/store';
import type {Owner} from '../types';
import type {Pull,Review} from './types';

export interface PullReadinessInput {
  number:number;draft:boolean;revision:number;commit:string;anchor:string;
  actor:Owner&{origin:string;via?:Review['via'];authorization?:string};
}

/** A separate authority row survives writers that only understand old Pull JSON.
 * The persisted merge fence also protects their serialized merge transaction. */
export function pullReadinessStorage(sql:SqlStorage){
  sql.exec('CREATE TABLE IF NOT EXISTS review_pull_readiness (pull INTEGER PRIMARY KEY, draft INTEGER NOT NULL CHECK(draft IN (0,1)), revision INTEGER NOT NULL CHECK(revision>=0))');
  sql.exec('CREATE TABLE IF NOT EXISTS review_pull_readiness_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
  const installed=sql.exec<{version:number}>('SELECT version FROM review_pull_readiness_schema WHERE id=1').toArray()[0];
  if(installed&&installed.version!==1)throw Error('Pull request draft tracking is updating');
  if(!installed){
    sql.exec("INSERT OR IGNORE INTO review_pull_readiness SELECT number,CASE WHEN json_type(data,'$.draft')='true' THEN 1 ELSE 0 END,CASE WHEN json_type(data,'$.draftRevision')='integer' AND json_extract(data,'$.draftRevision')>=0 THEN json_extract(data,'$.draftRevision') ELSE 0 END FROM review_pulls");
  }
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_pull_readiness_insert AFTER INSERT ON review_pulls BEGIN
    INSERT INTO review_pull_readiness VALUES(NEW.number,CASE WHEN json_type(NEW.data,'$.draft')='true' THEN 1 ELSE 0 END,0);
  END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_pull_readiness_merge BEFORE UPDATE ON review_pulls
    WHEN json_extract(NEW.data,'$.state')='merged' AND COALESCE((SELECT draft FROM review_pull_readiness WHERE pull=OLD.number),1)<>0
    BEGIN SELECT RAISE(ABORT,'Draft pull requests cannot be merged; mark ready for review first'); END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_pull_readiness_revision BEFORE UPDATE ON review_pull_readiness
    WHEN NEW.pull<>OLD.pull OR NEW.revision<>OLD.revision+1
    BEGIN SELECT RAISE(ABORT,'Pull request draft revision must advance'); END`);
  const mirror=`UPDATE review_pulls SET data=json_set(data,'$.draft',json(CASE WHEN (SELECT draft FROM review_pull_readiness WHERE pull=number)=1 THEN 'true' ELSE 'false' END),'$.draftRevision',(SELECT revision FROM review_pull_readiness WHERE pull=number))`;
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_pull_readiness_mirror AFTER UPDATE ON review_pull_readiness BEGIN ${mirror} WHERE number=NEW.pull; END`);
  // An old writer can preserve or omit fields, but cannot change draft authority.
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_pull_readiness_json AFTER UPDATE ON review_pulls
    WHEN EXISTS(SELECT 1 FROM review_pull_readiness WHERE pull=NEW.number) AND (
      json_type(NEW.data,'$.draft') IS NOT CASE WHEN (SELECT draft FROM review_pull_readiness WHERE pull=NEW.number)=1 THEN 'true' ELSE 'false' END
      OR json_extract(NEW.data,'$.draftRevision') IS NOT (SELECT revision FROM review_pull_readiness WHERE pull=NEW.number))
    BEGIN ${mirror} WHERE number=NEW.number; END`);
  sql.exec('CREATE TRIGGER IF NOT EXISTS review_pull_readiness_delete AFTER DELETE ON review_pulls BEGIN DELETE FROM review_pull_readiness WHERE pull=OLD.number; END');
  if(!installed)sql.exec('INSERT INTO review_pull_readiness_schema VALUES(1,1)');
}

export class PullReadiness {
  constructor(private sql:SqlStorage){}
  all(){
    return new Map(this.sql.exec<{pull:number;draft:number;revision:number}>('SELECT pull,draft,revision FROM review_pull_readiness').toArray().map(row=>[row.pull,this.valid(row)]));
  }
  private valid(value:{draft:number;revision:number}|undefined){
    if(!value||![0,1].includes(value.draft)||!Number.isSafeInteger(value.revision)||value.revision<0)throw Error('Pull request draft authority is unavailable; keep edits and merging closed');
    return {draft:value.draft===1,draftRevision:value.revision};
  }
  state(number:number){
    const value=this.sql.exec<{draft:number;revision:number}>('SELECT draft,revision FROM review_pull_readiness WHERE pull=?',number).toArray()[0];
    return this.valid(value);
  }
  edit(input:PullReadinessInput,pull:Pull,head:string){
    assertRepositoryWritable(this.sql);
    if(pull.state!=='open')throw Error('Only open pull requests can change draft status');
    if(typeof input.draft!=='boolean'||!Number.isSafeInteger(input.revision)||input.revision<0)throw Error('Use a draft status and current revision');
    if(head!==input.commit||pull.anchor!==input.anchor)throw Error('Pull request changed; inspect its latest diff');
    const before=this.state(pull.number);
    if(before.draftRevision!==input.revision)return {conflict:true as const,...before};
    if(before.draft===input.draft)return before;
    this.sql.exec('UPDATE review_pull_readiness SET draft=?,revision=revision+1 WHERE pull=?',input.draft?1:0,pull.number);
    this.sql.exec("UPDATE review_pulls SET data=json_set(data,'$.updatedAt',?) WHERE number=?",Date.now(),pull.number);
    new Repository(this.sql).audit({actor:input.actor.id,...(input.actor.via?{via:input.actor.via}:{}),pullReadiness:{pull:pull.number,draft:input.draft,revision:before.draftRevision+1}});
    return this.state(pull.number);
  }
}
