export async function defaultBranchCommand({action,pos,opts,base,token,request,output}) {
 if(pos.length||opts.file!==undefined||opts.confirm!==undefined)throw Error('Use repo default-branch or repo edit --default-branch BRANCH');
 if(action==='default-branch'&&(opts.revision!==undefined||opts['default-branch']!==undefined))throw Error('repo default-branch does not accept edit options');
 if(action==='edit'&&(!opts['default-branch']||opts.revision!==undefined&&!/^(0|[1-9]\d{0,15})$/.test(opts.revision)))throw Error('Use repo edit --default-branch BRANCH [--revision N]');
 const path=base+'/default-branch',data=await request(path,token);
 if(action==='default-branch'){
  output(data,`Default branch: ${data.defaultBranch}\nSettings revision: ${data.revision}\n`+(data.branches??[]).map(b=>`${b.name}\t${b.commit}`).join('\n'));return;
 }
 if(data.conditionalWrites!==true||data.cliAudit!==true||data.revisionTracking!=='storage')throw Error('Default branch administration is updating; inspect repo default-branch again shortly');
 if(data.mode!=='git'||data.readOnly||!data.canManage)throw Error('Changing the default requires an active Git repository, repository:default permission and your current admin role');
 const revision=opts.revision===undefined?data.revision:Number(opts.revision);
 if(!Number.isSafeInteger(revision)||revision<0||revision!==data.revision)throw Error('Repository settings changed; inspect repo default-branch before editing');
 const branch=data.branches?.find(b=>b.name===opts['default-branch']);
 if(!branch||!/^[a-f0-9]{40}$/.test(branch.commit))throw Error('The selected branch is unavailable; inspect repo default-branch before editing');
 const result=await request(path,token,{method:'PUT',revision,revisionType:'default',body:{branch:branch.name,commit:branch.commit,revision}});
 if(result.defaultBranch!==branch.name||!Number.isSafeInteger(result.revision))throw Error('Default branch change was not confirmed; inspect repo default-branch');
 output(result,`Default branch: ${result.defaultBranch}. Settings revision: ${result.revision}.`);
}
