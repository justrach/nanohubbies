import type {Review} from './types';
import {feedbackStorage} from './feedback-storage';

const names=['review_request_insert_v2','review_request_update_v2','review_request_delete_v2','review_request_answer_v2'];
const pending=(data:string)=>`json_extract(${data},'$.state')='requested'`;
const validReview=(data:string,pull:string)=>`(json_type(${data},'$.independent')='true' OR (
  json_extract(${data},'$.feedback.role')='reader' AND json_type(${data},'$.independent')='false'
  AND json_extract(${data},'$.verdict')='COMMENT' AND json_extract(${data},'$.feedback.verdict') IN ('COMMENT','APPROVE','REQUEST_CHANGES')))
  AND json_type(${data},'$.author.id')='text'
  AND json_type(${data},'$.pull')='integer' AND json_extract(${data},'$.pull')=${pull}
  AND json_type(${data},'$.at')='integer' AND json_extract(${data},'$.at')>=0
  AND json_extract(${data},'$.verdict') IN ('COMMENT','APPROVE','REQUEST_CHANGES')`;
const maximum=(pull:string)=>`COALESCE((SELECT MAX(id) FROM review_reviews WHERE pull=${pull}),0)`;
const counterGuard=(pull:string)=>`SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM review_request_revisions WHERE pull=${pull} AND typeof(revision)='integer' AND revision>=0 AND revision<9007199254740991) THEN RAISE(ABORT,'Review request revision is unavailable; keep edits closed') END;`;
const bump=(pull:string)=>`UPDATE review_request_revisions SET revision=revision+1 WHERE pull=${pull};`;
const normalize=(row:string)=>`UPDATE review_requests SET data=json_set(data,'$.generation',lower(hex(randomblob(16))))
  WHERE pull=${row}.pull AND reviewer=${row}.reviewer AND ${pending('data')} AND (json_type(data,'$.generation') IS NOT 'text' OR length(json_extract(data,'$.generation'))=0);`;
const remember=(row:string)=>`INSERT INTO review_request_tracking(pull,reviewer,request_data,after_review)
  SELECT q.pull,q.reviewer,q.data,${maximum('q.pull')} FROM review_requests q WHERE q.pull=${row}.pull AND q.reviewer=${row}.reviewer AND ${pending('q.data')}
  ON CONFLICT(pull,reviewer) DO UPDATE SET request_data=excluded.request_data,after_review=excluded.after_review;`;

/** Installed inside the caller's synchronous transaction. Request ordering is
 * an immutable review-ID high-water mark, independent of wall-clock order.
 * Stored triggers also cover code rolled back before this feature existed. */
export function requestStorage(sql:SqlStorage){
  sql.exec('CREATE TABLE IF NOT EXISTS review_requests (pull INTEGER NOT NULL, reviewer TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(pull,reviewer))');
  sql.exec('CREATE TABLE IF NOT EXISTS review_request_revisions (pull INTEGER PRIMARY KEY, revision INTEGER NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS review_request_tracking (pull INTEGER NOT NULL, reviewer TEXT NOT NULL, request_data TEXT NOT NULL, after_review INTEGER NOT NULL, PRIMARY KEY(pull,reviewer))');
  sql.exec('CREATE TABLE IF NOT EXISTS review_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, pull INTEGER NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS review_request_review_order ON review_reviews(pull,id)');
  sql.exec('CREATE TABLE IF NOT EXISTS repository_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)');
  feedbackStorage(sql);
  const installed=sql.exec<{n:number}>(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN (${names.map(name=>`'${name}'`).join(',')})`).toArray()[0].n;
  const readerAnswers=sql.exec("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='review_request_answer_v2' AND instr(sql,'$.feedback.role')>0").toArray().length>0;
  const untracked=sql.exec(`SELECT 1 FROM review_requests q LEFT JOIN review_request_tracking t ON t.pull=q.pull AND t.reviewer=q.reviewer
    WHERE ${pending('q.data')} AND (t.request_data IS NOT q.data OR typeof(t.after_review) IS NOT 'integer' OR t.after_review<0
      OR json_type(q.data,'$.generation') IS NOT 'text' OR length(json_extract(q.data,'$.generation'))=0) LIMIT 1`).toArray().length>0;
  if(installed===names.length&&!untracked&&readerAnswers)return;
  // Keep v2 names and ordering semantics: older healthy receivers leave the
  // extended hook in place rather than installing a duplicate answer trigger.
  sql.exec('DROP TRIGGER IF EXISTS review_request_answer_v2');

  // Invalidate old observations on migration/repair. A missing counter is never
  // recreated from a request snapshot; partial authority restores must stay closed.
  sql.exec('UPDATE review_request_revisions SET revision=revision+1 WHERE pull IN (SELECT DISTINCT pull FROM review_requests)');
  sql.exec(`UPDATE review_requests SET data=json_set(data,'$.generation',lower(hex(randomblob(16))))
    WHERE ${pending('data')} AND (json_type(data,'$.generation') IS NOT 'text' OR length(json_extract(data,'$.generation'))=0)`);
  // Pre-v2 rows without an ordering receipt cannot prove which historical review
  // followed the request. Preserve their pending state and start tracking now.
  sql.exec(`INSERT INTO review_request_tracking(pull,reviewer,request_data,after_review)
    SELECT q.pull,q.reviewer,q.data,${maximum('q.pull')} FROM review_requests q
    LEFT JOIN review_request_tracking t ON t.pull=q.pull AND t.reviewer=q.reviewer
    WHERE ${pending('q.data')} AND (t.request_data IS NOT q.data OR typeof(t.after_review) IS NOT 'integer' OR t.after_review<0)
    ON CONFLICT(pull,reviewer) DO UPDATE SET request_data=excluded.request_data,after_review=excluded.after_review`);

  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_request_insert_v2 AFTER INSERT ON review_requests BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM review_request_revisions WHERE pull=NEW.pull)
      AND EXISTS(SELECT 1 FROM review_request_tracking WHERE pull=NEW.pull) THEN RAISE(ABORT,'Review request revision is unavailable; keep edits closed') END;
    INSERT INTO review_request_revisions VALUES(NEW.pull,0) ON CONFLICT(pull) DO NOTHING;
    ${counterGuard('NEW.pull')} ${normalize('NEW')} ${remember('NEW')} ${bump('NEW.pull')}
  END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_request_update_v2 AFTER UPDATE ON review_requests
    WHEN OLD.data IS NOT NEW.data OR OLD.pull IS NOT NEW.pull OR OLD.reviewer IS NOT NEW.reviewer BEGIN
    ${counterGuard('OLD.pull')}
    INSERT INTO review_request_revisions VALUES(NEW.pull,0) ON CONFLICT(pull) DO NOTHING;
    ${counterGuard('NEW.pull')}
    DELETE FROM review_request_tracking WHERE pull=OLD.pull AND reviewer=OLD.reviewer AND (OLD.pull IS NOT NEW.pull OR OLD.reviewer IS NOT NEW.reviewer);
    ${normalize('NEW')} ${remember('NEW')} ${bump('NEW.pull')}
    UPDATE review_request_revisions SET revision=revision+1 WHERE pull=OLD.pull AND OLD.pull IS NOT NEW.pull;
  END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_request_delete_v2 AFTER DELETE ON review_requests BEGIN
    ${counterGuard('OLD.pull')} DELETE FROM review_request_tracking WHERE pull=OLD.pull AND reviewer=OLD.reviewer; ${bump('OLD.pull')}
  END`);
  sql.exec(`CREATE TRIGGER IF NOT EXISTS review_request_answer_v2 AFTER INSERT ON review_reviews
    WHEN ${validReview('NEW.data','NEW.pull')} AND EXISTS(
      SELECT 1 FROM review_requests q JOIN review_request_tracking t ON t.pull=q.pull AND t.reviewer=q.reviewer AND t.request_data=q.data
      WHERE q.pull=NEW.pull AND q.reviewer=json_extract(NEW.data,'$.author.id') AND ${pending('q.data')} AND NEW.id>t.after_review) BEGIN
    UPDATE review_requests SET data=json_set(data,'$.state','reviewed','$.reviewId',NEW.id,'$.answeredAt',json_extract(NEW.data,'$.at'))
      WHERE pull=NEW.pull AND reviewer=json_extract(NEW.data,'$.author.id') AND ${pending('data')};
    INSERT INTO repository_audit(data) VALUES(json_patch(json_object('actor',json_extract(NEW.data,'$.author.id'),'at',json_extract(NEW.data,'$.at'),
      'reviewRequest',json_object('pull',NEW.pull,'operation','answer','reviewers',json_array(json_extract(NEW.data,'$.author.id')),'reviewId',NEW.id)),
      CASE WHEN json_extract(NEW.data,'$.via.kind')='cli' AND json_type(NEW.data,'$.via.credentialId')='text'
        THEN json_object('via',json_object('kind','cli','credentialId',json_extract(NEW.data,'$.via.credentialId'))) ELSE '{}' END));
  END`);

  // A known high-water mark can reconcile reviews inserted while a trigger was
  // absent. First qualifying submitted review wins, exactly as in normal inserts.
  const missed=sql.exec<{id:number;pull:number;data:string}>(`SELECT r.id,r.pull,r.data FROM review_reviews r
    JOIN review_requests q ON q.pull=r.pull AND q.reviewer=json_extract(r.data,'$.author.id')
    JOIN review_request_tracking t ON t.pull=q.pull AND t.reviewer=q.reviewer AND t.request_data=q.data
    WHERE ${pending('q.data')} AND r.id>t.after_review AND ${validReview('r.data','r.pull')} ORDER BY r.id`).toArray();
  for(const row of missed){
    const review=JSON.parse(row.data) as Review;
    const exists=sql.exec(`SELECT 1 FROM review_requests WHERE pull=? AND reviewer=? AND ${pending('data')}`,row.pull,review.author.id).toArray().length;
    if(!exists)continue;
    sql.exec("UPDATE review_requests SET data=json_set(data,'$.state','reviewed','$.reviewId',?,'$.answeredAt',?) WHERE pull=? AND reviewer=?",row.id,review.at,row.pull,review.author.id);
    const via=review.via?.kind==='cli'&&typeof review.via.credentialId==='string'?{kind:'cli',credentialId:review.via.credentialId}:undefined;
    sql.exec('INSERT INTO repository_audit(data) VALUES(?)',JSON.stringify({actor:review.author.id,at:Date.now(),...(via?{via}:{}),reviewRequest:{pull:row.pull,operation:'answer',reviewers:[review.author.id],reviewId:row.id,reconciled:true}}));
  }
}
