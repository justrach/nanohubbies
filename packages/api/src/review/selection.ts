import { changesBetween } from "../browse/history";
import type { TrunkObjects } from "../browse/objects";
import { anchorInPatch, type CodeAnchor } from "./comments";
import type { Branch, Pull } from "./types";

export async function reviewSelection(objects:TrunkObjects,pull:Pull,head:Branch,body:Record<string,unknown>) {
  if(typeof body.path!=="string"||body.path.length>2048)throw Error("Select a changed file");
  const selection={path:body.path,side:body.side,startLine:body.startLine,line:body.line} as CodeAnchor;
  const diff=await changesBetween(objects,pull.anchorTree,head.tree),patch=diff.files.find(file=>file.path===selection.path)?.patch??null;
  if(!anchorInPatch(patch,selection))throw Error("Select up to 201 visible lines within one diff hunk");
  const chunk=patch!.split(/(?=^@@ )/m).find(part=>anchorInPatch(part,selection))??"";
  return {...selection,excerpt:chunk.length>24000?chunk.slice(0,24000)+"\n[Original hunk excerpt truncated]":chunk};
}
