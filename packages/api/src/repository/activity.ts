import type { ActivityQuery, RepositoryActivity, RepositoryEvent } from "./activity-types";
import { refName } from "./store";

/** Admin-only audit browsing. Keyset pagination stays stable when new events
 * arrive. Filter values are always SQL parameters, including deleted rulesets. */
export function repositoryActivity(sql: SqlStorage, query: ActivityQuery = {}): RepositoryActivity {
  const { before, limit = 25, kind = "all", ref, ruleset } = query;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
    (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) ||
    (ruleset !== undefined && (!Number.isSafeInteger(ruleset) || ruleset < 1)) ||
    !["all", "rulesets", "protections", "refs", "bypasses", "ci", "reviews", "environments", "archive", "settings"].includes(kind)) throw Error("Invalid activity filter");
  if (ref !== undefined) refName(ref);
  const clauses: string[] = [], values: (string | number)[] = [];
  if (before !== undefined) { clauses.push("id < ?"); values.push(before); }
  if (ref !== undefined) { clauses.push("json_extract(data, '$.ref') = ?"); values.push(ref); }
  if (ruleset !== undefined) {
    clauses.push("(json_extract(data, '$.ruleset.id') = ? OR json_extract(data, '$.removedRuleset') = ? OR json_extract(data, '$.restoredFrom.rulesetId') = ? OR EXISTS (SELECT 1 FROM json_each(data, '$.bypassedRulesets') WHERE value = ?))");
    values.push(ruleset, ruleset, ruleset, ruleset);
  }
  const filters = {
    all: "1",
    settings:"json_type(data, '$.defaultBranch') IS NOT NULL",
    archive:"json_type(data, '$.archive') IS NOT NULL",
    rulesets: "(json_type(data, '$.ruleset') IS NOT NULL OR json_type(data, '$.removedRuleset') IS NOT NULL)",
    protections: "(json_type(data, '$.policy') IS NOT NULL OR json_type(data, '$.removedPolicy') IS NOT NULL)",
    refs: "json_type(data, '$.ref') IS NOT NULL",
    bypasses: "json_array_length(data, '$.bypassedRulesets') > 0",
    ci: "(json_type(data, '$.stagingApproval') IS NOT NULL OR json_type(data, '$.retry') IS NOT NULL)",
    reviews: "json_type(data, '$.dismissal') IS NOT NULL",
    environments:"(json_type(data, '$.environment') IS NOT NULL OR json_type(data, '$.removedEnvironment') IS NOT NULL OR json_type(data, '$.deploymentRequest') IS NOT NULL OR json_type(data, '$.deploymentReview') IS NOT NULL OR json_type(data, '$.deploymentAuthorization') IS NOT NULL)",
  };
  clauses.push(filters[kind]);
  const rows = sql.exec<{id:number;data:string}>(`SELECT id, data FROM repository_audit WHERE ${clauses.join(" AND ")} ORDER BY id DESC LIMIT ?`, ...values, limit + 1).toArray();
  const events = rows.slice(0, limit).map(row => {
    const data = JSON.parse(row.data);
    // Project known fields; future internal audit payloads are not automatically
    // exposed just because another caller adds data to an audit record.
    const event: RepositoryEvent = { id: row.id, at: data.at, actor: data.actor };
    if(data.via?.kind==="cli"&&typeof data.via.credentialId==="string")event.via={kind:"cli",credentialId:data.via.credentialId};
    if(data.defaultBranch)event.defaultBranch=data.defaultBranch;
    for (const key of ["ref", "old", "next", "merge", "force", "human", "bypassedRulesets", "bypassRole", "ruleset", "previousRuleset", "removedRuleset", "restoredFrom", "policy", "previousPolicy", "removedPolicy", "stagingApproval", "retry", "head", "base", "dismissal", "environment", "previousEnvironment", "removedEnvironment", "deploymentRequest", "deploymentReview", "deploymentAuthorization", "archive"] as const)
      if (key in data) Object.assign(event, { [key]: data[key] });
    return event;
  });
  return { events, nextCursor: rows.length > limit ? events.at(-1)!.id : null };
}
