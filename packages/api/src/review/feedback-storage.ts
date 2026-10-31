/** Old receivers read COMMENT/independent=false, so reader opinions cannot
 * count after promotion, override a writer's decision or veto a peer PR. */
export function feedbackStorage(sql:SqlStorage){
 const valid=`json_type(NEW.data,'$.feedback')='object'
  AND json_extract(NEW.data,'$.feedback.role')='reader'
  AND json_extract(NEW.data,'$.feedback.verdict') IN ('COMMENT','APPROVE','REQUEST_CHANGES')
  AND json_extract(NEW.data,'$.verdict')='COMMENT'
  AND json_type(NEW.data,'$.independent')='false'`;
 for(const operation of ['INSERT','UPDATE'] as const)sql.exec(`CREATE TRIGGER IF NOT EXISTS review_feedback_fence_${operation.toLowerCase()}
  BEFORE ${operation} ON review_reviews
  WHEN json_type(NEW.data,'$.feedback') IS NOT NULL AND (${valid}) IS NOT 1
  BEGIN SELECT RAISE(ABORT,'Reader feedback cannot acquire review authority'); END`);
 sql.exec(`CREATE TRIGGER IF NOT EXISTS review_feedback_identity_update BEFORE UPDATE ON review_reviews
  WHEN json_type(OLD.data,'$.feedback') IS NOT json_type(NEW.data,'$.feedback')
   OR json_extract(OLD.data,'$.feedback.role') IS NOT json_extract(NEW.data,'$.feedback.role')
   OR json_extract(OLD.data,'$.feedback.verdict') IS NOT json_extract(NEW.data,'$.feedback.verdict')
   OR (json_type(OLD.data,'$.feedback') IS NOT NULL AND (
    OLD.pull IS NOT NEW.pull
    OR json_extract(OLD.data,'$.pull') IS NOT json_extract(NEW.data,'$.pull')
    OR json_extract(OLD.data,'$.author.id') IS NOT json_extract(NEW.data,'$.author.id')
    OR json_extract(OLD.data,'$.commit') IS NOT json_extract(NEW.data,'$.commit')
    OR json_extract(OLD.data,'$.anchor') IS NOT json_extract(NEW.data,'$.anchor')))
  BEGIN SELECT RAISE(ABORT,'Published reader feedback identity is immutable'); END`);
}
