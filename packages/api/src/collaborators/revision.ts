/** Triggers cover browser/older RPC writers and invitation acceptance as well
 * as the CLI. Counters stay after deletion so remove/re-add is observable. */
export function collaboratorRevisions(sql:SqlStorage) {
 // The marker lives in SQL: a surrounding transaction can roll back schema
 // initialization, so an isolate-only initialized flag would be incorrect.
 if(sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='collaborator_revision_schema_v1'").toArray().length)return;
 sql.exec('CREATE TABLE IF NOT EXISTS collaborator_revisions (trunk TEXT PRIMARY KEY,revision INTEGER NOT NULL)');
 for(const table of ['collaborators','repo_invitations','team_bindings'])for(const event of ['INSERT','UPDATE','DELETE']){
  const row=event==='DELETE'?'OLD':'NEW';
  sql.exec(`CREATE TRIGGER IF NOT EXISTS access_revision_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN
    INSERT INTO collaborator_revisions(trunk,revision) VALUES(${row}.trunk,1) ON CONFLICT(trunk) DO UPDATE SET revision=revision+1;
  END`);
 }
 if(!sql.exec<{name:string}>('PRAGMA table_info(access_audit)').toArray().some(column=>column.name==='credential_id'))sql.exec('ALTER TABLE access_audit ADD COLUMN credential_id TEXT');
 sql.exec('CREATE TABLE collaborator_revision_schema_v1 (id INTEGER PRIMARY KEY)');
}
export function collaboratorRevision(sql:SqlStorage,trunk:string) {
 return sql.exec<{revision:number}>('SELECT revision FROM collaborator_revisions WHERE trunk=?',trunk).toArray()[0]?.revision??0;
}
