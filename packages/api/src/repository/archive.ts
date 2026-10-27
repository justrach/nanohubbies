import type {ArchiveState,ArchiveChange} from "./archive-types";
export type {ArchiveState,ArchiveChange} from "./archive-types";
export const archiveLocked = (state: ArchiveState) => state.archived || !!state.transition&&!state.transition.committed;
export const archiveMessage = "Repository is archived or changing archive state; unarchive it before making changes";
/** Hub owns the transition; Room and Sequencer retain monotonic local mirrors
 * so their final synchronous writers do not depend on a prior HTTP check. */
export class ArchiveStore {
  constructor(private sql: SqlStorage, private repository = "") {
    sql.exec("CREATE TABLE IF NOT EXISTS repository_archives (repository TEXT PRIMARY KEY, data TEXT NOT NULL)");
  }
  state(): ArchiveState {
    const row = this.sql.exec<{data:string}>("SELECT data FROM repository_archives WHERE repository=?", this.repository).toArray()[0];
    return row ? JSON.parse(row.data) : {archived:false,revision:0,actor:null,updatedAt:null,transition:null};
  }
  private save(state: ArchiveState) {
    this.sql.exec("INSERT INTO repository_archives VALUES (?,?) ON CONFLICT(repository) DO UPDATE SET data=excluded.data", this.repository, JSON.stringify(state));
    return state;
  }
  writable() { if (archiveLocked(this.state())) throw Error(archiveMessage); }
  prepare(archived: boolean, revision: number, actor: string, now = Date.now(), options?:{conditional?:boolean;via?:ArchiveChange["via"]}) {
    if (typeof archived !== "boolean" || !Number.isSafeInteger(revision) || revision < 0) throw Error("Choose an archive state and current revision");
    const state = this.state();
    if(options?.conditional&&state.revision!==revision&&!(state.transition?.archived===archived&&revision===state.transition.revision-1))throw Error("Archive state changed; refresh before continuing");
    if (state.transition&&!(state.transition.committed&&archived)) {
      if (state.transition.archived !== archived || ![state.revision,state.transition.revision-1].includes(revision)) throw Error("Archive transition is pending; retry its current operation before changing state");
      return state;
    }
    if (state.archived === archived) return state;
    if (state.revision !== revision) throw Error("Archive state changed; refresh before continuing");
    return this.save({...state,transition:{id:crypto.randomUUID(),archived,revision:revision+1,actor,at:now,...(options?.via?{via:options.via}:{})}});
  }
  apply(change: ArchiveChange) {
    const state = this.state();
    if (change.revision < state.revision) return {state,changed:false};
    if (change.revision === state.revision) {
      if (change.archived !== state.archived) throw Error("Conflicting archive revision");
      return {state,changed:false};
    }
    return {state:this.save({archived:change.archived,revision:change.revision,actor:change.actor,updatedAt:change.at,transition:null}),changed:true};
  }
  beginOpening(change:ArchiveChange) {
    const state=this.state();
    if(change.archived||state.transition?.id!==change.id)throw Error("Archive operation changed; refresh");
    return this.save({archived:false,revision:change.revision,actor:change.actor,updatedAt:change.at,transition:{...change,committed:true}});
  }
  complete(change: ArchiveChange) {
    const state = this.state();
    if(!state.transition&&state.revision===change.revision&&state.archived===change.archived)return state;
    if (state.transition?.id !== change.id) throw Error("Archive operation changed; refresh");
    return this.save({archived:change.archived,revision:change.revision,actor:change.actor,updatedAt:change.at,transition:null});
  }
  forget() { this.sql.exec("DELETE FROM repository_archives WHERE repository=?",this.repository); }
}
export const assertRepositoryWritable = (sql: SqlStorage, repository = "") => new ArchiveStore(sql,repository).writable();
