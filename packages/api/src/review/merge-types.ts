export type MergeMethod="fast-forward"|"merge"|"squash"|"rebase";
/** Trusted object-derived evidence, never read from HTTP JSON. */
export interface GeneratedMergeEvidence {
  version:1;
  method:Exclude<MergeMethod,"fast-forward">;
  base:string;
  head:string;
  result:string;
  /** Result and reviewed head have the same exact tree in strict mode. */
  tree:string;
  rewritten?:{original:string;commit:string}[];
}
