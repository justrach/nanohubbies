import {validName, scopeKey, type VaultScope} from './provider';

export type VaultEdit = {credentialId:string} & (
  {operation:'connect';revision:number;name:string;binding:string} |
  {operation:'disconnect';revision:number;name:string} |
  {operation:'grant';revision:number;id:string;hash:string;names:string[];expires:number} |
  {operation:'revoke';id:string}
);
export interface VaultAuthority {authorize():Promise<number>}
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);

/** Reference revisions observe both legacy UI and delegated writers. Grant
 * recovery receipts outlive revocation only until their fixed expiry. They
 * contain hashes, never grant credentials or Cloudflare-owned secret values. */
export class VaultAdministration {
  constructor(private sql:SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS vault_configuration_revision(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL)');
    sql.exec('INSERT OR IGNORE INTO vault_configuration_revision VALUES(1,0)');
    for(const operation of ['INSERT','UPDATE','DELETE'])sql.exec(`CREATE TRIGGER IF NOT EXISTS vault_reference_${operation.toLowerCase()} AFTER ${operation} ON secret_references BEGIN UPDATE vault_configuration_revision SET revision=revision+1 WHERE id=1; END`);
    if(!sql.exec<{name:string}>('PRAGMA table_info(audit)').toArray().some(column=>column.name==='credential_id'))sql.exec('ALTER TABLE audit ADD COLUMN credential_id TEXT');
    sql.exec('CREATE TABLE IF NOT EXISTS cli_grant_receipts(id TEXT PRIMARY KEY,actor TEXT NOT NULL,hash TEXT NOT NULL,names TEXT NOT NULL,expires INTEGER NOT NULL,credential_id TEXT NOT NULL)');
    sql.exec('CREATE INDEX IF NOT EXISTS cli_grant_expiry ON cli_grant_receipts(expires)');
  }
  revision(){return this.sql.exec<{revision:number}>('SELECT revision FROM vault_configuration_revision WHERE id=1').toArray()[0].revision;}
  configuration(){return {revision:this.revision(),conditionalWrites:true as const,revisionTracking:'storage' as const,clientGrants:'v1' as const,cliAudit:true as const};}
  prune(now=Date.now()){this.sql.exec('DELETE FROM cli_grant_receipts WHERE expires<=?',now);}
  private audit(scope:VaultScope,input:VaultEdit,action:string,target:string,now:number){this.sql.exec('INSERT INTO audit(actor,action,target,at,credential_id) VALUES(?,?,?,?,?)',scope.actor,action,target,now,input.credentialId);}
  /** Called inside the Vault's transaction, after its final private authority
   * callback. There are no awaits between authorization and these mutations. */
  edit(scope:VaultScope,input:VaultEdit,validateBinding:(name:string,binding:string)=>void,now=Date.now()) {
    scopeKey(scope);
    if(!input||typeof input!=='object'||Array.isArray(input)||!uuid(input.credentialId))throw Error('A current CLI credential identity is required');
    const fields=input.operation==='connect'?['revision','name','binding']:input.operation==='disconnect'?['revision','name']:input.operation==='grant'?['revision','id','hash','names','expires']:input.operation==='revoke'?['id']:null;
    if(!fields||Object.keys(input).some(key=>!['operation','credentialId',...fields].includes(key)))throw Error('Use reference and grant metadata only; unknown administration fields are rejected');
    this.prune(now);
    if(input.operation==='revoke'){
      if(!uuid(input.id))throw Error('Use a workload grant ID');
      this.sql.exec('DELETE FROM managed_grants WHERE id=?',input.id);
      // The receipt remains until expiry, so a saved file cannot resurrect it.
      this.audit(scope,input,'cli-revoke-grant',input.id,now);
      return {revoked:true as const,id:input.id,...this.configuration()};
    }
    if(!Number.isSafeInteger(input.revision)||input.revision<0)throw Error('Use the reference revision from secret list');
    if(input.operation==='grant'){
      if(!uuid(input.id)||!/^[a-f0-9]{64}$/.test(input.hash)||!Array.isArray(input.names)||!input.names.length||input.names.length>100||!input.names.every(validName)||new Set(input.names).size!==input.names.length||!Number.isSafeInteger(input.expires))throw Error('Use a private client-generated workload grant');
      const names=JSON.stringify([...input.names].sort());
      const prior=this.sql.exec<{actor:string;hash:string;names:string;expires:number;credential_id:string}>('SELECT actor,hash,names,expires,credential_id FROM cli_grant_receipts WHERE id=?',input.id).toArray()[0];
      if(prior){
        if(prior.actor!==scope.actor||prior.hash!==input.hash||prior.names!==names||prior.expires!==input.expires||prior.credential_id!==input.credentialId)throw Error('Conflicting workload grant recovery');
        const active=this.sql.exec<{hash:string;names:string;expires:number;actor:string;uses:number}>('SELECT hash,names,expires,actor,uses FROM managed_grants WHERE id=?',input.id).toArray()[0];
        if(!active||active.hash!==prior.hash||active.actor!==prior.actor||active.names!==prior.names||active.expires!==prior.expires||active.expires<=now||active.uses>=100)throw Error('Workload grant is no longer available and cannot be recovered');
        for(const name of input.names){const ref=this.sql.exec<{binding:string}>('SELECT binding FROM secret_references WHERE name=?',name).toArray()[0];if(!ref)throw Error('Secret reference unavailable');validateBinding(name,ref.binding);}
        return {grant:{id:input.id,expires:prior.expires,names:JSON.parse(names) as string[],created:false},...this.configuration()};
      }
      if(input.expires<=now||input.expires>now+3600000)throw Error('Use a fixed workload grant expiry within the next hour');
      if(this.sql.exec<{n:number}>('SELECT count(*) AS n FROM cli_grant_receipts').toArray()[0].n>=1000)throw Error('Too many recent workload grant operations; wait for saved grants to expire');
    }else if(!['connect','disconnect'].includes(input.operation)||!validName(input.name))throw Error('Use a secret reference name');
    if(this.revision()!==input.revision)return {conflict:true as const,...this.configuration()};
    if(input.operation==='connect'){
      if(typeof input.binding!=='string')throw Error('Use a Cloudflare binding reference');validateBinding(input.name,input.binding);
      const previous=this.sql.exec<{version:number}>('SELECT version FROM secret_references WHERE name=?',input.name).toArray()[0];
      if(!previous&&this.sql.exec<{n:number}>('SELECT count(*) AS n FROM secret_references').toArray()[0].n>=100)throw Error('At most 100 secret references per environment');
      this.sql.exec('INSERT INTO secret_references(name,binding,version,updated,actor) VALUES(?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET binding=excluded.binding,version=excluded.version,updated=excluded.updated,actor=excluded.actor',input.name,input.binding,(previous?.version??0)+1,now,scope.actor);
      this.audit(scope,input,'cli-connect-cloudflare-secret',input.name,now);
      return {secret:{name:input.name,binding:input.binding,version:(previous?.version??0)+1,updated:now},...this.configuration()};
    }
    if(input.operation==='disconnect'){
      this.sql.exec('DELETE FROM secret_references WHERE name=?',input.name);
      for(const grant of this.sql.exec<{id:string;names:string}>('SELECT id,names FROM managed_grants').toArray())if((JSON.parse(grant.names) as string[]).includes(input.name))this.sql.exec('DELETE FROM managed_grants WHERE id=?',grant.id);
      this.audit(scope,input,'cli-disconnect-cloudflare-secret',input.name,now);
      return {disconnected:true as const,valueRetainedByCloudflare:true as const,...this.configuration()};
    }
    this.sql.exec('DELETE FROM managed_grants WHERE expires<=? OR uses>=100',now);
    if(this.sql.exec<{n:number}>('SELECT count(*) AS n FROM managed_grants').toArray()[0].n>=100)throw Error('Too many active grants');
    for(const name of input.names){const ref=this.sql.exec<{binding:string}>('SELECT binding FROM secret_references WHERE name=?',name).toArray()[0];if(!ref)throw Error('Secret reference unavailable');validateBinding(name,ref.binding);}
    const names=JSON.stringify([...input.names].sort());
    this.sql.exec('INSERT INTO managed_grants(id,hash,names,expires,actor) VALUES(?,?,?,?,?)',input.id,input.hash,names,input.expires,scope.actor);
    this.sql.exec('INSERT INTO cli_grant_receipts VALUES(?,?,?,?,?,?)',input.id,scope.actor,input.hash,names,input.expires,input.credentialId);
    this.audit(scope,input,'cli-grant',input.id,now);
    return {grant:{id:input.id,expires:input.expires,names:JSON.parse(names) as string[],created:true},...this.configuration()};
  }
}
