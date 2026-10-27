export const cliPermissions=[
  ["read","Read pull requests, diffs and Actions history"],
  ["contents:read","Clone and fetch repository contents"],
  ["contents:write","Push repository contents"],
  ["pulls:write","Create and close pull requests"],
  ["reviews:write","Submit reviews and manage inline conversations"],
  ["pulls:merge","Merge pull requests that satisfy repository rules"],
  ["rulesets:write","Create, change or remove rulesets and bypass accounts (repository admins only)"],
  ["protections:write","Change or remove branch protection rules (repository admins only)"],
  ["repository:archive","Archive or unarchive this repository (repository admins only)"],
  ["repository:default","Change the default branch (repository admins only)"],
  ["environments:write","Manage deployment environments, reviewers and source restrictions (repository admins only)"],
] as const;
export const cliPermissionLabels:Record<string,string>=Object.fromEntries(cliPermissions);
export const cliReadScope=(scope:string)=>scope==="read"||scope==="contents:read";
export const cliArchivedScope=(scope:string)=>cliReadScope(scope)||scope==="repository:archive";
export function toggleCliScope(previous:string[],scope:string,checked:boolean) {
  const next=new Set(previous);
  if(checked){next.add(scope);if(scope==="contents:write")next.add("contents:read");}
  else{next.delete(scope);if(scope==="contents:read")next.delete("contents:write");}
  return [...next];
}
