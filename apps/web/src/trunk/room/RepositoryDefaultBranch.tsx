"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {api,trunkPath} from "@/lib/api";
import {useSession} from "@/lib/session";
import {Button} from "@/components/controls";
import {Card} from "@/components/ui";
import {useTrunk} from "../context";
import {field} from "../review/shared";
type Configuration={mode:"git"|"snapshot";defaultBranch:string;revision:number;branches:{name:string;commit:string}[]};
export function RepositoryDefaultBranch({trunk,canEdit}:{trunk:string;canEdit:boolean}) {
  const {readOnly}=useTrunk(),{user}=useSession(),router=useRouter(),path=trunkPath(trunk)+"/default-branch";
  const [data,setData]=useState<Configuration|null>(null),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const generation=useRef(0),lock=useRef(false),failure=useRef<HTMLParagraphElement>(null),scope=`${trunk}/${user?.id??""}`,current=useRef(scope);current.current=scope;
  async function load(){const requested=scope,g=++generation.current;setBusy(true);setError("");try{const value=await api<Configuration>(path);if(current.current===requested&&g===generation.current){setData(value);setSelected(value.defaultBranch);}}catch(e){if(current.current===requested&&g===generation.current)setError((e as Error).message);}finally{if(current.current===requested&&g===generation.current)setBusy(false);}}
  useEffect(()=>{setData(null);setSelected("");setError("");setNotice("");void load();return()=>{generation.current++;};},[scope,path]);
  useEffect(()=>{if(error)failure.current?.focus();},[error]);
  async function save(){
    if(!data||lock.current)return;
    const branch=data.branches.find(b=>b.name===selected);if(!branch)return;
    lock.current=true;const requested=scope,g=++generation.current;setBusy(true);setError("");setNotice("");
    try{const result=await api<{defaultBranch:string;revision:number}>(path,{method:"PUT",body:{branch:branch.name,commit:branch.commit,revision:data.revision}});if(current.current===requested&&g===generation.current){setData({...data,...result});setNotice(`Default branch changed to ${result.defaultBranch}.`);router.refresh();}}
    catch(e){if(current.current===requested&&g===generation.current)setError((e as Error).message);}
    finally{lock.current=false;if(current.current===requested&&g===generation.current)setBusy(false);}
  }
  if(data?.mode==="snapshot")return null;
  return <Card className="min-w-0 space-y-4 p-5"><header className="space-y-2"><h2 className="text-lg font-semibold">Default branch</h2><p className="max-w-[70ch] text-sm leading-6 text-muted">Clones and new pull requests start from this branch. Existing pull requests keep their target. Rules that follow the default branch move with your selection.</p></header>
    {data?<><p className="break-all text-sm">Current default: <strong><bdi>{data.defaultBranch}</bdi></strong></p>{canEdit&&<form className="flex min-w-0 flex-wrap items-end gap-3" onSubmit={event=>{event.preventDefault();void save();}}><label className="min-w-0 max-w-xl flex-[1_1_240px] space-y-1 text-sm">Branch<select className={`${field} block w-full min-w-0`} value={selected} onChange={event=>{setSelected(event.target.value);setNotice("");}} disabled={readOnly||busy||!data.branches.length}>{!data.branches.length&&<option value={data.defaultBranch}>{data.defaultBranch}</option>}{data.branches.map(branch=><option key={branch.name} value={branch.name}>{branch.name}</option>)}</select></label><Button type="submit" variant="primary" disabled={readOnly||busy||selected===data.defaultBranch||!data.branches.length}>{busy?"Saving…":"Change default branch"}</Button></form>}{!data.branches.length&&<p className="text-xs leading-6 text-muted">Push the first branch before changing the default.</p>}</>:!error&&<p role="status" className="text-sm text-muted">Loading default branch…</p>}
    {error&&<p ref={failure} tabIndex={-1} role="alert" className="text-sm text-critical">{error}</p>}{notice&&<p role="status" className="break-words text-sm">{notice}</p>}
    <Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setNotice("");void load();}}>Refresh branches</Button>
  </Card>;
}
