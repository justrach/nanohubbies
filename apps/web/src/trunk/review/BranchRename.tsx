"use client";
import {useRef,useState} from 'react';
import type {BranchRenameConfiguration,BranchRenamePreview} from '@swarm/api/review';
import {api,ApiError,trunkPath} from '@/lib/api';
import {Button} from '@/components/controls';
import {field,Notice} from './shared';
type Result=BranchRenameConfiguration&{renamed:{from:string;to:string;commit:string;retargetedPulls:number[];closedPulls:number[]}};
type Preview=BranchRenameConfiguration&{preview:BranchRenamePreview;canRename:boolean;canRenameProtected:boolean;readOnly:boolean};
export function BranchRename({trunk,from,onCancel,onInspect,onRenamed}:{trunk:string;from:string;onCancel:()=>void;onInspect:()=>void;onRenamed:(result:Result)=>void}){
 const [to,setTo]=useState(''),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[uncertain,setUncertain]=useState(false);
 const input=useRef<HTMLInputElement>(null),summary=useRef<HTMLDivElement>(null),pending=useRef(false);
 const path=trunkPath(trunk)+'/branch-rename';
 const cancel=()=>{if(!pending.current)onCancel();};
 async function inspect(){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');
  try{
   const data=await api<Preview>(path+'?'+new URLSearchParams({from,to}));
   if(data.protocol!==1||data.revisionTracking!=='storage'||data.conditionalWrites!==true||!data.preview||data.preview.from!==from||data.preview.to!==to||data.preview.revision!==data.revision)throw Error('Branches changed or rename administration is updating. Review the rename again shortly.');
   if(data.readOnly||!data.canRename)throw Error('Renaming requires write access to an active Git repository.');
   if(data.preview.requiresAdmin&&!data.canRenameProtected)throw Error('A repository admin must rename this default or protected branch.');
   setPreview(data);requestAnimationFrame(()=>summary.current?.focus());
  }catch(e){setError((e as Error).message);}
  finally{pending.current=false;setBusy(false);}
 }
 async function rename(){
  if(!preview||pending.current||uncertain)return;pending.current=true;setBusy(true);setError('');
  try{
   const result=await api<Result>(path,{method:'POST',body:{from,to,commit:preview.preview.commit,revision:preview.preview.revision}});
   if(result.renamed?.from!==from||result.renamed.to!==to||result.renamed.commit!==preview.preview.commit||!Array.isArray(result.branches)||typeof result.defaultBranch!=='string')throw Error('Rename was not confirmed.');
   onRenamed(result);
  }catch(e){
   if(e instanceof ApiError&&[400,401,403,409,412,413,428].includes(e.status)){setPreview(null);setError(e.message+' Review the current rename before saving again.');}
   else{setUncertain(true);setError((e as Error).message+' Refresh the branch list to inspect the result before starting another rename.');}
  }
  finally{pending.current=false;setBusy(false);}
 }
 return <form className="branch-rename" aria-label={'Rename '+from} onSubmit={event=>{event.preventDefault();void (preview?rename():inspect());}} onKeyDown={event=>{if(event.key==='Escape'&&!busy){event.preventDefault();cancel();}}}>
  <Notice error={error}/>
  {!preview?<><label>New branch name<input ref={input} className={field} autoFocus value={to} onChange={event=>{setTo(event.target.value);setError('');}} required maxLength={244} autoComplete="off" spellCheck={false} disabled={busy}/></label><p>Rename <bdi>{from}</bdi>. You’ll review the effects before saving.</p></>:<div ref={summary} tabIndex={-1} className="branch-rename-preview">
   <p>Rename <strong><bdi>{from}</bdi></strong> to <strong><bdi>{to}</bdi></strong>?</p>
   <p>Commit <code>{preview.preview.commit.slice(0,7)}</code> stays the same.{preview.preview.protectionFollows||preview.preview.updatedRulesets.length?' Existing protection settings follow the new name.':''}</p>
   {preview.preview.defaultBranch&&<p>This is the repository’s default branch.</p>}
   {preview.preview.retargetedPulls.length>0&&<p>{preview.preview.retargetedPulls.length} open pull {preview.preview.retargetedPulls.length===1?'request will':'requests will'} target the new branch name.</p>}
   {preview.preview.closedPulls.length>0&&<p>{preview.preview.closedPulls.length} pull {preview.preview.closedPulls.length===1?'request using this branch as its head will close':'requests using this branch as their head will close'}. Their reviews and discussions stay available.</p>}
   <p>Local clones keep their current branch names. Update them after renaming.</p>
  </div>}
  <div className="branch-rename-actions"><Button type="submit" size="sm" variant="primary" disabled={busy||uncertain||!preview&&!to.trim()}>{busy?(preview?'Renaming…':'Checking…'):preview?'Rename branch':'Review rename'}</Button>{preview&&!uncertain&&<Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setPreview(null);requestAnimationFrame(()=>input.current?.focus());}}>Edit name</Button>}{uncertain&&<Button size="sm" disabled={busy} onClick={onInspect}>Refresh branches</Button>}<Button size="sm" variant="ghost" disabled={busy} onClick={cancel}>{uncertain?'Close':'Cancel'}</Button></div>
 </form>;
}
