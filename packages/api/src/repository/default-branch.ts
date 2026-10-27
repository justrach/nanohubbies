/** Snapshot workspaces retain main. Git repositories own their symbolic HEAD. */
export function defaultBranch(sql:SqlStorage):string {
  if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_config'").toArray().length)return "main";
  return sql.exec<{default_branch:string}>("SELECT default_branch FROM repository_config WHERE id=1").toArray()[0]?.default_branch??"main";
}
export const defaultRef=(sql:SqlStorage)=>`refs/heads/${defaultBranch(sql)}`;
export function defaultCommit(sql:SqlStorage):string|null {
  if(!sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='repository_refs'").toArray().length)return null;
  return sql.exec<{commit_sha:string}>("SELECT commit_sha FROM repository_refs WHERE name=?",defaultRef(sql)).toArray()[0]?.commit_sha??null;
}
