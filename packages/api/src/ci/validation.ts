import type {CheckResult} from './types';
import {validConclusion} from './conclusions';
export function validCheckResults(results:unknown):results is CheckResult[] {
 return Array.isArray(results)&&results.length<=30&&new Set(results.map(r=>r?.name)).size===results.length&&!results.some(r=>!r||typeof r!=='object'||Object.keys(r).some(key=>!['name','state','command','log','artifacts','execution'].includes(key))||typeof r.name!=='string'||!/^[-\w./]{1,100}$/.test(r.name)||!validConclusion(r.state)||(r.execution&&(r.execution.provider!=='codegraff'||typeof r.execution.sandboxId!=='string'||!/^[-A-Za-z0-9_]{1,160}$/.test(r.execution.sandboxId)||typeof r.execution.workflow!=='string'||r.execution.workflow.length>200||typeof r.execution.job!=='string'||r.execution.job.length>100))||typeof r.command!=='string'||!r.command.trim()||typeof r.log!=='string'||!Array.isArray(r.artifacts)||r.artifacts.some((a:unknown)=>typeof a!=='string'));
}
