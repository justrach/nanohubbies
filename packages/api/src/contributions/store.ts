import {assertRepositoryWritable} from '../repository/archive';
import type {ContributionAgent,ContributionEvent,ContributionFilter,ContributionPage,AgentWork,WorkStart,WorkReport,WorkLink} from './types';
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const plain=(value:unknown,max:number)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\0\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value);
type WithoutSequence<T>=T extends unknown?Omit<T,'seq'>:never;
export function workLinks(value:unknown):WorkLink[]{
 if(!Array.isArray(value)||value.length>20)throw Error('Link up to 20 repository commits or pull requests');
 const links=value.map(link=>{if(!link||typeof link!=='object'||Array.isArray(link))throw Error('Invalid work link');
  if(link.kind==='commit'&&Object.keys(link).every(k=>['kind','sha'].includes(k))&&typeof link.sha==='string'&&/^[a-f0-9]{40}$/.test(link.sha))return {kind:'commit' as const,sha:link.sha};
  if(link.kind==='pull'&&Object.keys(link).every(k=>['kind','number'].includes(k))&&Number.isSafeInteger(link.number)&&link.number>0&&link.number<=1e9)return {kind:'pull' as const,number:link.number};throw Error('Use a full commit SHA or positive pull request number');});
 return [...new Map(links.map(link=>[JSON.stringify(link),link])).values()];
}
export class Contributions {
 constructor(private sql:SqlStorage){
  sql.exec('CREATE TABLE IF NOT EXISTS agent_work_sessions (id TEXT PRIMARY KEY, agent TEXT NOT NULL, initial TEXT NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS agent_work_owner ON agent_work_sessions(agent)');
  sql.exec('CREATE TABLE IF NOT EXISTS agent_work_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, agent TEXT NOT NULL, session TEXT, data TEXT NOT NULL)');
  sql.exec('CREATE INDEX IF NOT EXISTS agent_work_session_events ON agent_work_events(session)');
  sql.exec('CREATE TABLE IF NOT EXISTS agent_work_links (event INTEGER NOT NULL, kind TEXT NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(event,kind,artifact))');
  sql.exec('CREATE INDEX IF NOT EXISTS agent_work_artifact ON agent_work_links(kind,artifact,event)');
  sql.exec('CREATE TABLE IF NOT EXISTS agent_contributors (agent TEXT PRIMARY KEY, data TEXT NOT NULL, sessions INTEGER NOT NULL, pushes INTEGER NOT NULL, last_seq INTEGER NOT NULL, last_at INTEGER NOT NULL)');
 }
 private append(key:string,event:WithoutSequence<ContributionEvent>,session?:string):ContributionEvent {
  this.sql.exec('INSERT INTO agent_work_events(event_key,agent,session,data) VALUES(?,?,?,?)',key,event.agent.id,session??null,JSON.stringify(event));
  const seq=this.sql.exec<{id:number}>('SELECT last_insert_rowid() AS id').toArray()[0].id;
  for(const link of event.links)this.sql.exec('INSERT OR IGNORE INTO agent_work_links VALUES(?,?,?)',seq,link.kind,link.kind==='commit'?link.sha:String(link.number));
  this.sql.exec('INSERT INTO agent_contributors VALUES(?,?,?,?,?,?) ON CONFLICT(agent) DO UPDATE SET data=excluded.data,sessions=sessions+excluded.sessions,pushes=pushes+excluded.pushes,last_seq=excluded.last_seq,last_at=excluded.last_at',event.agent.id,JSON.stringify(event.agent),event.kind==='work_started'?1:0,event.kind==='git_push'?1:0,seq,event.at);
  return{...event,seq}as ContributionEvent;
 }
 get(id:string,agent?:string):AgentWork {
  const row=this.sql.exec<{agent:string;data:string}>('SELECT agent,data FROM agent_work_sessions WHERE id=?',id).toArray()[0];if(!row||agent&&row.agent!==agent)throw Error('Work session not found');return JSON.parse(row.data);
 }
 start(agent:ContributionAgent,input:WorkStart,now=Date.now()):AgentWork {
  assertRepositoryWritable(this.sql);
  if(!input||Object.keys(input).some(k=>!['sessionId','title','client'].includes(k))||!uuid(input.sessionId)||!plain(input.title,160))throw Error('Use a UUID session ID and a task title up to 160 characters');
  if(input.client!==undefined&&(!input.client||typeof input.client!=='object'||Array.isArray(input.client)||!plain(input.client.name,80)||Object.keys(input.client).some(k=>!['name','version','model'].includes(k))||input.client.version!==undefined&&!plain(input.client.version,80)||input.client.model!==undefined&&!plain(input.client.model,120)))throw Error('Use bounded, client-reported name, version and model labels');
  const initial=JSON.stringify({title:input.title,...(input.client?{client:input.client}:{})}),prior=this.sql.exec<{agent:string;initial:string;data:string}>('SELECT agent,initial,data FROM agent_work_sessions WHERE id=?',input.sessionId).toArray()[0];
  if(prior){if(prior.agent!==agent.id)throw Error('Work session not found');if(prior.initial!==initial)throw Error('Session ID already describes different work');return JSON.parse(prior.data);}
  if(this.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM agent_work_sessions').toArray()[0].n>=10000)throw Error('Repository work-session limit reached');
  const work:AgentWork={id:input.sessionId,agent,title:input.title,...(input.client?{client:input.client}:{}),state:'working',summary:'',links:[],createdAt:now,updatedAt:now};
  this.sql.exec('INSERT INTO agent_work_sessions VALUES(?,?,?,?)',work.id,agent.id,initial,JSON.stringify(work));
  this.append(`start:${work.id}`,{kind:'work_started',agent,at:now,sessionId:work.id,title:work.title,state:work.state,summary:'',links:[],...(work.client?{client:work.client}:{})},work.id);return work;
 }
 report(agent:ContributionAgent,input:WorkReport,now=Date.now()):AgentWork {
  assertRepositoryWritable(this.sql);
  if(!input||Object.keys(input).some(k=>!['sessionId','eventId','state','summary','links'].includes(k))||!uuid(input.sessionId)||!uuid(input.eventId)||!['working','blocked','completed'].includes(input.state)||!plain(input.summary,4000))throw Error('Use UUID session/event IDs, a work state and a summary up to 4,000 characters');
  const links=workLinks(input.links),work=this.get(input.sessionId,agent.id),eventKey=`report:${work.id}:${input.eventId}`;
  const prior=this.sql.exec<{data:string}>('SELECT data FROM agent_work_events WHERE event_key=?',eventKey).toArray()[0];
  if(prior){const event=JSON.parse(prior.data)as ContributionEvent;if(event.kind!=='work_reported'||event.state!==input.state||event.summary!==input.summary||JSON.stringify(event.links)!==JSON.stringify(links))throw Error('Event ID already describes a different update');return work;}
  if(work.state==='completed')throw Error('This work session is complete; start a new session');
  if(this.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM agent_work_events WHERE session=?',work.id).toArray()[0].n>=200)throw Error('Work session update limit reached');
  work.state=input.state;work.summary=input.summary;work.updatedAt=now;work.links=workLinks([...new Map([...work.links,...links].map(link=>[JSON.stringify(link),link])).values()]);
  this.sql.exec('UPDATE agent_work_sessions SET data=? WHERE id=? AND agent=?',JSON.stringify(work),work.id,agent.id);
  this.append(eventKey,{kind:'work_reported',agent:work.agent,at:now,sessionId:work.id,title:work.title,state:work.state,summary:input.summary,links,...(work.client?{client:work.client}:{})},work.id);return work;
 }
 push(agent:ContributionAgent,ref:string,old:string|null,next:string|null,commit?:string,now=Date.now()) {
  // Called inside the same trusted ref transaction. Rejected pushes leave no
  // contribution, and display names in Git author headers never select an actor.
  const links:WorkLink[]=commit?[{kind:'commit',sha:commit}]:[];
  return this.append('push:'+crypto.randomUUID(),{kind:'git_push',agent,at:now,ref,old,next,...(commit?{commit}:{}),links});
 }
 page(filter:ContributionFilter={}):ContributionPage {
  const {before,limit=25,pull,commit}=filter;
  if(!Number.isSafeInteger(limit)||limit<1||limit>50||before!==undefined&&(!Number.isSafeInteger(before)||before<1)||pull!==undefined&&(!Number.isSafeInteger(pull)||pull<1)||commit!==undefined&&!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid contribution cursor or artifact filter');
  const args:(string|number)[]=[],where:string[]=[];if(before){where.push('e.seq<?');args.push(before);}
  const artifacts:string[]=[];if(pull!==undefined){artifacts.push("(l.kind='pull' AND l.artifact=?)");args.push(String(pull));}if(commit!==undefined){artifacts.push("(l.kind='commit' AND l.artifact=?)");args.push(commit);}
  if(artifacts.length)where.push(`EXISTS(SELECT 1 FROM agent_work_links l WHERE l.event=e.seq AND (${artifacts.join(' OR ')}))`);
  const rows=this.sql.exec<{seq:number;data:string}>(`SELECT e.seq,e.data FROM agent_work_events e${where.length?' WHERE '+where.join(' AND '):''} ORDER BY e.seq DESC LIMIT ?`,...args,limit+1).toArray();
  const scope=artifacts.length?` WHERE EXISTS(SELECT 1 FROM agent_work_links l WHERE l.event=e.seq AND (${artifacts.join(' OR ')}))`:'';
  const scopeArgs=args.slice(before?1:0);
  const agents=artifacts.length?this.sql.exec<{data:string;sessions:number;pushes:number}>(`SELECT e.data,s.sessions,s.pushes FROM (SELECT e.agent,COUNT(DISTINCT e.session) AS sessions,SUM(CASE WHEN json_extract(e.data,'$.kind')='git_push' THEN 1 ELSE 0 END) AS pushes,MAX(e.seq) AS last FROM agent_work_events e${scope} GROUP BY e.agent ORDER BY last DESC LIMIT 100) s JOIN agent_work_events e ON e.seq=s.last ORDER BY e.seq DESC`,...scopeArgs).toArray().map(row=>{const value=JSON.parse(row.data)as ContributionEvent;return{agent:value.agent,sessions:row.sessions,pushes:row.pushes,lastActiveAt:value.at};}):this.sql.exec<{data:string;sessions:number;pushes:number;last_at:number}>('SELECT data,sessions,pushes,last_at FROM agent_contributors ORDER BY last_seq DESC LIMIT 100').toArray().map(row=>({agent:JSON.parse(row.data),sessions:row.sessions,pushes:row.pushes,lastActiveAt:row.last_at}));
  const agentCount=artifacts.length?this.sql.exec<{n:number}>(`SELECT COUNT(DISTINCT e.agent) AS n FROM agent_work_events e${scope}`,...scopeArgs).toArray()[0].n:this.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM agent_contributors').toArray()[0].n;
  return {events:rows.slice(0,limit).map(row=>({...JSON.parse(row.data),seq:row.seq})),nextCursor:rows.length>limit?rows[limit-1].seq:null,agentCount,agents};
 }
}
