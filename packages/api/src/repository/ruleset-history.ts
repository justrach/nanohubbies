import { Rulesets, validateRuleset } from "./rulesets";
import type { RulesetRestorePreview } from "./ruleset-types";
import { Repository } from "./store";

/** Call mutations inside the sequencer's transaction. The saved audit snapshot,
 * never client-supplied configuration, is the source of a restored version. */
export class RulesetHistory {
  constructor(private sql: SqlStorage) {}

  preview(rulesetId: number, eventId: number): RulesetRestorePreview {
    if (![rulesetId, eventId].every(n => Number.isSafeInteger(n) && n > 0))
      throw Error("Invalid ruleset history selection");
    const row = this.sql.exec<{ data: string }>(
      "SELECT data FROM repository_audit WHERE id = ?", eventId,
    ).toArray()[0];
    if (!row) throw Error("Recorded ruleset version unavailable");
    const event = JSON.parse(row.data);
    const snapshot = event.ruleset?.id === rulesetId ? event.ruleset
      : event.removedRuleset === rulesetId && event.previousRuleset?.id === rulesetId ? event.previousRuleset : null;
    if (!snapshot) throw Error("This event has no version of the selected ruleset");
    const { id: _id, ...input } = snapshot;
    // Revalidate old records against current supported rules. Unsupported history
    // fails explicitly rather than dropping a restriction during restoration.
    const selected = validateRuleset(input), plan = new Rulesets(this.sql).plan();
    return { eventId, rulesetId, revision: plan.revision, recordedAt: event.at,
      current: plan.rulesets.find(r => r.id === rulesetId) ?? null, selected };
  }

  restore(rulesetId: number, eventId: number, expectedRevision: number, actor: string) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw Error("A valid comparison revision is required");
    const preview = this.preview(rulesetId, eventId);
    if (preview.revision !== expectedRevision)
      return { conflict: true as const, revision: preview.revision };
    const rules = new Rulesets(this.sql);
    const ruleset = rules.set(preview.selected, preview.current?.id);
    new Repository(this.sql).audit({ actor, ruleset, previousRuleset: preview.current,
      restoredFrom: { rulesetId, eventId } });
    return { restored: true as const, ruleset, revision: rules.plan().revision };
  }
}
