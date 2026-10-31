const usage='Use branch list or branch rename OLD NEW [--revision REVISION]';
export async function branchCommand({action,pos,opts,base,token,request,output}){
 if(Object.keys(opts).some(key=>!['positionals','host','repo','trunk','helper','json','revision'].includes(key)))throw Error(usage);
 if(action==='list'&&(pos.length||opts.revision!==undefined)||action==='rename'&&(pos.length!==2||pos.some(name=>!name||/[\0\r\n]/.test(name))||pos[0]===pos[1]||opts.revision!==undefined&&!/^[a-f0-9]{64}$/.test(opts.revision)))throw Error(usage);
 const path=base+'/branch-rename',query=action==='rename'?'?'+new URLSearchParams({from:pos[0],to:pos[1]}):'';
 const data=await request(path+query,token);
 if(data.protocol!==1||data.conditionalWrites!==true||data.revisionTracking!=='storage'||data.cliAudit!==true||!/^[a-f0-9]{64}$/.test(data.revision)||!Array.isArray(data.branches))throw Error('Branch rename administration is updating; inspect branch list again shortly');
 if(action==='list'){output(data,`Default: ${data.defaultBranch}\nRevision: ${data.revision}\n`+data.branches.map(branch=>`${branch.name}\t${branch.commit}${branch.name===data.defaultBranch?'\tdefault':''}`).join('\n'));return;}
 const preview=data.preview;
 if(data.mode!=='git'||data.readOnly||!data.canRename)throw Error('Renaming requires an active Git repository and current branches:write permission');
 if(!preview||preview.from!==pos[0]||preview.to!==pos[1]||preview.revision!==data.revision||!/^[a-f0-9]{40}$/.test(preview.commit))throw Error('Branch rename preview is unavailable; inspect branch list');
 if(preview.requiresAdmin&&!data.canRenameProtected)throw Error('Current repository admin access is required to rename default or protected branches');
 if(opts.revision!==undefined&&opts.revision!==data.revision)throw Error('Branches or repository settings changed; inspect branch list before renaming');
 const body={from:preview.from,to:preview.to,commit:preview.commit,revision:preview.revision};
 const result=await request(path,token,{method:'POST',body,revision:body.revision,revisionType:'branch-rename'});
 if(result.renamed?.from!==body.from||result.renamed.to!==body.to||result.renamed.commit!==body.commit||!/^[a-f0-9]{64}$/.test(result.revision))throw Error('Rename was not confirmed; inspect branch list before repeating the operation');
 output(result,`Renamed ${body.from} to ${body.to}. Local clones keep their current branch names.`);
}
