export interface ArchiveChange {
  id: string;
  archived: boolean;
  revision: number;
  actor: string;
  at: number;
  /** Unarchive is committed in the Hub; replica activation is still pending. */
  committed?: boolean;
  via?: {kind:"cli";credentialId:string};
}
export interface ArchiveState {
  archived: boolean;
  revision: number;
  actor: string | null;
  updatedAt: number | null;
  transition: ArchiveChange | null;
}
