import type {Owner} from '../types';
/** The profile is resolved from the registered credential, never tool input. */
export interface ContributionAgent {id:string;handle:string;type:string;owner:Owner}
export interface ReportedClient {name:string;version?:string;model?:string}
export type WorkLink={kind:'commit';sha:string}|{kind:'pull';number:number};
export type WorkState='working'|'blocked'|'completed';
export interface AgentWork {id:string;agent:ContributionAgent;title:string;client?:ReportedClient;state:WorkState;summary:string;links:WorkLink[];createdAt:number;updatedAt:number}
export interface WorkStart {sessionId:string;title:string;client?:ReportedClient}
export interface WorkReport {sessionId:string;eventId:string;state:WorkState;summary:string;links:WorkLink[]}
export type ContributionEvent=({kind:'work_started'|'work_reported';sessionId:string;title:string;state:WorkState;summary:string;links:WorkLink[];client?:ReportedClient}|{kind:'git_push';ref:string;old:string|null;next:string|null;commit?:string;links:WorkLink[]})&{seq:number;agent:ContributionAgent;at:number};
export interface ContributionFilter {before?:number;limit?:number;pull?:number;commit?:string}
export interface ContributionPage {events:ContributionEvent[];nextCursor:number|null;agentCount:number;agents:{agent:ContributionAgent;sessions:number;pushes:number;lastActiveAt:number}[]}
