import type { Ruleset } from "./ruleset-types";

/** Rule requirements are readable by repository members. Bypass identities
 * belong to the settings view and are returned only to human rule editors. */
export function visibleRuleset(rule: Ruleset, canEdit: boolean): Ruleset {
  if (canEdit) return rule;
  const { bypass_actors, ...visible } = rule;
  return visible;
}
