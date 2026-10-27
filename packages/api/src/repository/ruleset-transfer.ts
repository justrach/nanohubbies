import { validateRuleset } from "./rulesets";
import type { Ruleset, RulesetInput, RulesetImportPreview } from "./ruleset-types";

const metadata = ["id", "node_id", "source", "source_type", "created_at", "updated_at", "_links"];
const configurationKeys = ["name", "target", "enforcement", "conditions", "rules", "bypass_actors"];

/** Imported account IDs cannot carry authority across hosts. Unknown policy
 * fields fail closed; only explicitly identified display metadata is omitted. */
export function importRuleset(value: unknown): RulesetImportPreview {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Import one ruleset JSON object");
  const source = value as Record<string, unknown>;
  const unknown = Object.keys(source).filter(k => !metadata.includes(k) && !configurationKeys.includes(k));
  if (unknown.length) throw Error(`Unsupported ruleset field: ${unknown.join(", ")}`);
  if (source.bypass_actors !== undefined && (!Array.isArray(source.bypass_actors) || source.bypass_actors.length))
    throw Error("Imported bypass accounts are not supported. Remove bypass_actors and configure local accounts after importing.");
  const notes: string[] = [];
  const ignored = metadata.filter(k => Object.hasOwn(source, k));
  if (ignored.length) notes.push(`Source metadata omitted: ${ignored.join(", ")}. A new repository-local ID will be assigned.`);
  const input = Object.fromEntries(configurationKeys.filter(k => Object.hasOwn(source, k)).map(k => [k, source[k]]));
  if (input.conditions && typeof input.conditions === "object" && !Array.isArray(input.conditions)) {
    const conditions = input.conditions as Record<string, unknown>;
    if (Object.hasOwn(conditions, "repository_name")) {
      const selector = conditions.repository_name as {include?: unknown;exclude?: unknown} | null;
      if (!selector || typeof selector !== "object" || Object.keys(selector).some(k=>!["include","exclude"].includes(k)) ||
        !Array.isArray(selector.include) || selector.include.length !== 1 || selector.include[0] !== "~ALL" ||
        !Array.isArray(selector.exclude) || selector.exclude.length)
        throw Error("Repository selection conditions cannot be imported here. Only an all-repositories selector can map to this repository.");
      const { repository_name: _repository, ...rest } = conditions;
      if (input.target === "push" && !Object.keys(rest).length) delete input.conditions;
      else input.conditions = rest;
      notes.push("The source all-repositories selector is mapped to this repository only.");
    }
  }
  let configuration: RulesetInput;
  try { configuration = validateRuleset(input as unknown as RulesetInput); }
  catch (error) { throw Error(`Cannot import ruleset: ${(error as Error).message}`); }
  return { configuration, notes };
}

/** Portable configuration never includes source IDs, account bypasses or audit
 * metadata. The supported restrictions themselves are preserved exactly. */
export function exportRuleset(rule: RulesetInput | Ruleset): Omit<RulesetInput, "bypass_actors"> {
  const { id: _id, ...input } = rule as Ruleset;
  const { bypass_actors: _bypass, ...configuration } = validateRuleset(input);
  return configuration;
}
