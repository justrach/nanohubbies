export interface SuggestionText { lines:string[]; before:string; after:string }

/** Recognize one complete CommonMark-style suggestion fence outside other fences. */
export function suggestionText(body:string):SuggestionText|null {
  const lines=body.replace(/\r\n?/g,"\n").split("\n");
  let fence:{char:string;length:number;start:number;suggestion:boolean}|null=null;
  const found:{start:number;end:number;lines:string[]}[]=[];
  for(let i=0;i<lines.length;i++) {
    if(fence) {
      const close=/^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
      if(close&&close[1][0]===fence.char&&close[1].length>=fence.length) {
        if(fence.suggestion)found.push({start:fence.start,end:i,lines:lines.slice(fence.start+1,i)});
        fence=null;
      }
    } else {
      const open=/^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(lines[i]);
      if(open&&!(open[1][0]==="`"&&open[2].includes("`")))fence={char:open[1][0],length:open[1].length,start:i,suggestion:open[2].trim()==="suggestion"};
    }
  }
  if(found.length!==1||fence?.suggestion)return null;
  const selected=found[0];
  if(selected.lines.some(line=>line.includes("\0")))return null;
  return {lines:selected.lines,before:lines.slice(0,selected.start).join("\n").trim(),after:lines.slice(selected.end+1).join("\n").trim()};
}

export function suggestionFence(lines:string[]) {
  const content=lines.join("\n"),runs=content.match(/`+/g)??[];
  const fence="`".repeat(Math.max(3,...runs.map(run=>run.length+1)));
  return `${fence}suggestion\n${content}${lines.length?"\n":""}${fence}`;
}

/** Replace whole selected lines, preserving bytes outside the range and EOF style. */
export function replaceSuggestion(text:string,startLine:number,line:number,replacement:string[]) {
  if(!Number.isSafeInteger(startLine)||!Number.isSafeInteger(line)||startLine<1||line<startLine||line-startLine>200)throw Error("Invalid suggestion line range");
  const starts:number[]=text.length?[0]:[];
  for(let i=0;i<text.length;i++)if(text[i]==="\n"&&i+1<text.length)starts.push(i+1);
  if(line>starts.length)throw Error("Suggestion lines are no longer in the file");
  const from=starts[startLine-1],end=starts[line]??text.length,original=text.slice(from,end);
  const first=original.indexOf("\n"),fallback=text.indexOf("\n"),source=first>=0?original:text,index=first>=0?first:fallback;
  const ending=index>0&&source[index-1]==="\r"?"\r\n":"\n";
  const next=replacement.join(ending)+(replacement.length&&original.endsWith("\n")?ending:"");
  if(next===original)throw Error("Suggestion does not change the selected code");
  return text.slice(0,from)+next+text.slice(end);
}
