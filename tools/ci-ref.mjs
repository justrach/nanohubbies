/** Ref context comes from the authenticated claim, never from workflow env. */
export function sourceRef(run) {
 const ref=run.ref??`refs/heads/${run.branch}`,match=/^refs\/(heads|tags)\/([\s\S]+)$/.exec(ref);
 if(!match||match[2]!==run.branch)throw Error('Invalid claimed source ref');
 return {ref,name:match[2],type:match[1]==='heads'?'branch':'tag'};
}
