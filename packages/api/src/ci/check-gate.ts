import type { CheckSource } from "../repository/types";
import type { Run, RunnerSource } from "./types";
import { passingCheck } from "./conclusions";

/** The delivering source is the authenticated run lease, never result JSON. */
export function checkFailure(run: Run | undefined, name: string, pins: CheckSource[] = [], sources: RunnerSource[] = [],successOnly=false): string | null {
  const expected = [...new Set(pins.filter(pin => pin.name === name).map(pin => pin.runner))];
  if (expected.length > 1) return `Required check ${name} has conflicting expected runner sources in matching protection rules`;
  if (expected.length) {
    const source = sources.find(source => source.id === expected[0]);
    if (!source || source.revoked) return `Required check ${name} expects an unavailable or revoked runner source (${expected[0]})`;
    if (run?.runner !== source.id) return `Required check ${name} must be reported by ${source.name} (${source.id})`;
  }
  if (run?.state !== "complete") return `Required check ${name} has not succeeded`;
  const results = run.results.filter(result => result.name === name);
  if (results.length !== 1 || !passingCheck(results[0])) return `Required check ${name} has not succeeded${results.length === 1 ? ` (${results[0].state})` : ""}`;
  if(successOnly&&results[0].state!=="success")return `Required check ${name} requires Success; its conclusion is ${results[0].state}`;
  if (name === "staging" && !run.staging) return "Required check staging has not succeeded with verified deployment evidence";
  return null;
}
