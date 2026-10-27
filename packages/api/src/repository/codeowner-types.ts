export interface CodeOwnerGroup {
  line: number;
  pattern: string;
  owners: string[];
  paths: string[];
  files: number;
}
/** Computed from immutable base/head objects by trusted application code. */
export interface CodeOwnerEvidence {
  base: string;
  head: string;
  file: string | null;
  groups: CodeOwnerGroup[];
  warnings: { line: number; message: string }[];
  error?: string;
}
export interface CodeOwnerStatus extends Omit<CodeOwnerEvidence, "groups"> {
  required: boolean;
  missing: number;
  groups: (CodeOwnerGroup & { eligibleOwners: string[]; approved: boolean })[];
}
