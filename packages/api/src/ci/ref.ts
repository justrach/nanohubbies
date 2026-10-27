import {refName} from '../repository/ref-name';
import type {Run} from './types';
type RefRun=Pick<Run,'branch'|'head'|'ref'|'refTarget'>;
/** Legacy runs are branch pushes. Tag context is produced by the trusted Git
 * object reader; neither reporters nor deployment-review JSON can choose it. */
export function runRef(run:RefRun) {
 const ref=run.ref??`refs/heads/${run.branch}`;
 const match=/^refs\/(heads|tags)\/([\s\S]+)$/.exec(ref);
 if(!match||match[2]!==run.branch)throw Error('Invalid CI ref identity');
 return refName(ref);
}
export const runRefTarget=(run:RefRun)=>run.refTarget??run.head;
