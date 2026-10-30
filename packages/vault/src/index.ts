import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {VaultAdministration,type VaultEdit,type VaultAuthority} from './administration';
import {
  bindingFor,
  references,
  scopeKey,
  validName,
  digest,
  type VaultScope,
} from "./provider";
interface VaultEnv {
  VAULTS: DurableObjectNamespace<Vault>;
  CLOUDFLARE_SECRET_SCOPES?: string;
  [name: string]: unknown;
}
export type Scope = VaultScope;
export interface SecretInput {
  name: string;
  binding: string;
}
export interface GrantInput {
  names: string[];
  ttlSeconds: number;
}
/** Cloudflare Secrets Store owns secret values and encryption. This private,
 * on-demand Worker owns only scoped references, grants and audit metadata. */
export class VaultService extends WorkerEntrypoint<VaultEnv> {
  #store(s: Scope) {
    return this.env.VAULTS.get(this.env.VAULTS.idFromName(scopeKey(s)));
  }
  list(s: Scope) {
    return this.#store(s).list(s);
  }
  administer(s:Scope,input:VaultEdit,authority:VaultAuthority){
    return this.#store(s).administer(s,input,authority);
  }
  put(s: Scope, input: SecretInput) {
    return this.#store(s).put(s, input);
  }
  remove(s: Scope, name: string) {
    return this.#store(s).remove(s, name);
  }
  grant(s: Scope, input: GrantInput) {
    return this.#store(s).grant(s, input);
  }
  revoke(s: Scope, id: string) {
    return this.#store(s).revoke(s, id);
  }
  principal(s: Scope, token: string) {
    return this.#store(s).principal(s, token);
  }
  principalInfo(s:Scope,token:string){return this.#store(s).principalInfo(s,token);}
  redeem(s: Scope, token: string) {
    return this.#store(s).redeem(s, token);
  }
  redeemAuthorized(s:Scope,token:string,authority:VaultAuthority){return this.#store(s).redeemAuthorized(s,token,authority);}
}
export class Vault extends DurableObject<VaultEnv> {
  #sql: SqlStorage;
  #administration:VaultAdministration;
  constructor(ctx: DurableObjectState, env: VaultEnv) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    // A new table deliberately leaves any pre-existing encrypted values
    // untouched. Values must be migrated by their owner into Secrets Store.
    this.#sql.exec(
      "CREATE TABLE IF NOT EXISTS secret_references(name TEXT PRIMARY KEY,binding TEXT NOT NULL,version INTEGER NOT NULL,updated INTEGER,actor TEXT)",
    );
    this.#sql.exec(
      "CREATE TABLE IF NOT EXISTS managed_grants(id TEXT PRIMARY KEY,hash TEXT UNIQUE,names TEXT,expires INTEGER,actor TEXT,uses INTEGER DEFAULT 0)",
    );
    this.#sql.exec(
      "CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,action TEXT,target TEXT,at INTEGER)",
    );
    this.#administration=new VaultAdministration(this.#sql);
  }
  #audit(s: Scope, action: string, target: string) {
    this.#sql.exec(
      "INSERT INTO audit(actor,action,target,at) VALUES(?,?,?,?)",
      s.actor,
      action,
      target,
      Date.now(),
    );
  }
  async #schedule() {
    // Expired recovery metadata is pruned opportunistically. Tombstones do
    // not schedule alarms or keep the runtime active after all grants end.
    this.#administration.prune();
    this.#sql.exec(
      "DELETE FROM managed_grants WHERE expires <= ? OR uses >= 100",
      Date.now(),
    );
    const next = this.#sql
      .exec<{
        at: number | null;
      }>("SELECT MIN(expires) AS at FROM managed_grants")
      .toArray()[0]?.at;
    if (next) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.#schedule();
  }
  async list(s: Scope) {
    scopeKey(s);
    const legacy = this.#sql
      .exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='secrets'",
      )
      .toArray().length
      ? this.#sql
          .exec<{ n: number }>("SELECT count(*) AS n FROM secrets")
          .toArray()[0].n
      : 0;
    return {
      ...this.#administration.configuration(),
      provider: "cloudflare-secrets-store",
      runtime: "on-demand",
      valueCustody: "cloudflare",
      nextCleanupAt: await this.ctx.storage.getAlarm(),
      legacyValuesAwaitingMigration: legacy,
      available: references(this.env, s),
      secrets: this.#sql
        .exec<{
          name: string;
          binding: string;
          version: number;
          updated: number;
          actor: string;
        }>("SELECT name,binding,version,updated,actor FROM secret_references ORDER BY name")
        .toArray(),
      grants: this.#sql
        .exec<{
          id: string;
          names: string;
          expires: number;
          actor: string;
          uses: number;
        }>(
          "SELECT id,names,expires,actor,uses FROM managed_grants WHERE expires > ? AND uses < 100 ORDER BY expires",
          Date.now(),
        )
        .toArray()
        .map((g) => ({ ...g, names: JSON.parse(g.names) as string[] })),
      audit: this.#sql
        .exec<{
          actor: string;
          action: string;
          target: string;
          at: number;
          credentialId:string|null;
        }>("SELECT actor,action,target,at,credential_id AS credentialId FROM audit ORDER BY id DESC LIMIT 50")
        .toArray(),
    };
  }
  async administer(s:Scope,input:VaultEdit,authority:VaultAuthority){
    scopeKey(s);
    if(typeof authority?.authorize!=='function')throw Error('Private vault authorization is required');
    const expiresAt=await authority.authorize(),now=Date.now();
    if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+30000)throw Error('Vault authorization expired or unavailable');
    const result=this.ctx.storage.transactionSync(()=>this.#administration.edit(s,input,(name,binding)=>{bindingFor(this.env,s,name,binding);},now));
    await this.#schedule();
    return result;
  }
  put(s: Scope, input: SecretInput) {
    if (
      !input ||
      !validName(input.name) ||
      typeof input.binding !== "string" ||
      Object.hasOwn(input, "value")
    )
      throw Error(
        "Register a Cloudflare Secrets Store binding; values must be entered in Cloudflare",
      );
    bindingFor(this.env, s, input.name, input.binding);
    return this.ctx.storage.transactionSync(() => {
      const previous = this.#sql
        .exec<{
          version: number;
        }>("SELECT version FROM secret_references WHERE name = ?", input.name)
        .toArray()[0];
      if (
        !previous &&
        this.#sql
          .exec<{ n: number }>("SELECT count(*) AS n FROM secret_references")
          .toArray()[0].n >= 100
      )
        throw Error("At most 100 secret references per environment");
      const version = (previous?.version ?? 0) + 1,
        updated = Date.now();
      this.#sql.exec(
        "INSERT OR REPLACE INTO secret_references VALUES(?,?,?,?,?)",
        input.name,
        input.binding,
        version,
        updated,
        s.actor,
      );
      this.#audit(s, "connect-cloudflare-secret", input.name);
      return { name: input.name, binding: input.binding, version, updated };
    });
  }
  async remove(s: Scope, name: string) {
    scopeKey(s);
    if (!validName(name)) throw Error("Invalid secret name");
    this.#sql.exec("DELETE FROM secret_references WHERE name = ?", name);
    for (const g of this.#sql
      .exec<{
        id: string;
        names: string;
      }>("SELECT id,names FROM managed_grants")
      .toArray())
      if ((JSON.parse(g.names) as string[]).includes(name))
        this.#sql.exec("DELETE FROM managed_grants WHERE id = ?", g.id);
    this.#audit(s, "disconnect-cloudflare-secret", name);
    await this.#schedule();
    return { disconnected: true, valueRetainedByCloudflare: true };
  }
  async grant(s: Scope, input: GrantInput) {
    scopeKey(s);
    if (
      !Array.isArray(input.names) ||
      !input.names.length ||
      input.names.length > 100 ||
      !input.names.every(validName) ||
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < 60 ||
      input.ttlSeconds > 3600
    )
      throw Error("Choose secret names and a lifetime of 60–3600 seconds");
    for (const name of input.names) {
      const row = this.#sql
        .exec<{
          binding: string;
        }>("SELECT binding FROM secret_references WHERE name = ?", name)
        .toArray()[0];
      if (!row) throw Error("Secret reference unavailable");
      bindingFor(this.env, s, name, row.binding);
    }
    const token =
        "nhv_" +
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      hash = await digest(token),
      id = crypto.randomUUID(),
      expires = Date.now() + input.ttlSeconds * 1000;
    this.#sql.exec(
      "DELETE FROM managed_grants WHERE expires <= ? OR uses >= 100",
      Date.now(),
    );
    if (
      this.#sql
        .exec<{ n: number }>("SELECT count(*) AS n FROM managed_grants")
        .toArray()[0].n >= 100
    )
      throw Error("Too many active grants");
    this.#sql.exec(
      "INSERT INTO managed_grants(id,hash,names,expires,actor) VALUES(?,?,?,?,?)",
      id,
      hash,
      JSON.stringify([...new Set(input.names)]),
      expires,
      s.actor,
    );
    this.#audit(s, "grant", id);
    await this.#schedule();
    return { id, token, expires };
  }
  async revoke(s: Scope, id: string) {
    scopeKey(s);
    this.#sql.exec("DELETE FROM managed_grants WHERE id = ?", id);
    this.#audit(s, "revoke", id);
    await this.#schedule();
    return { revoked: true };
  }
  async #grant(s: Scope, token: string) {
    scopeKey(s);
    if (typeof token !== "string" || !/^nh(?:v|w)_[a-f0-9]{64}$/.test(token))
      throw Error("Workload grant unavailable");
    const g = this.#sql
      .exec<{
        id: string;
        names: string;
        expires: number;
        uses: number;
        actor: string;
      }>("SELECT id,names,expires,uses,actor FROM managed_grants WHERE hash = ?", await digest(token))
      .toArray()[0];
    if (!g || g.expires <= Date.now() || g.uses >= 100)
      throw Error("Workload grant unavailable");
    if(token.startsWith('nhw_')&&!this.#sql.exec('SELECT 1 FROM cli_grant_receipts WHERE id=?',g.id).toArray().length)throw Error('Workload grant delegation cannot be verified');
    return g;
  }
  async principal(s: Scope, token: string) {
    const grant=await this.#grant(s,token);
    if(this.#sql.exec('SELECT 1 FROM cli_grant_receipts WHERE id=?',grant.id).toArray().length)throw Error('CLI workload grants require delegation-aware redemption');
    return grant.actor;
  }
  async principalInfo(s:Scope,token:string){
    const grant=await this.#grant(s,token),receipt=this.#sql.exec<{actor:string;names:string;expires:number;credential_id:string;hash:string}>('SELECT actor,names,expires,credential_id,hash FROM cli_grant_receipts WHERE id=?',grant.id).toArray()[0];
    if(receipt&&(receipt.actor!==grant.actor||receipt.names!==grant.names||receipt.expires!==grant.expires||receipt.hash!==await digest(token)))throw Error('Workload grant delegation cannot be verified');
    return {actor:grant.actor,credentialId:receipt?.credential_id??null};
  }
  async redeem(s: Scope, token: string) {
    return this.#redeem(s,token);
  }
  async redeemAuthorized(s:Scope,token:string,authority:VaultAuthority){
    if(typeof authority?.authorize!=='function')throw Error('Private workload authorization is required');
    return this.#redeem(s,token,authority);
  }
  async #redeem(s:Scope,token:string,authority?:VaultAuthority){
    const grant = await this.#grant(s, token);
    if(!authority&&this.#sql.exec('SELECT 1 FROM cli_grant_receipts WHERE id=?',grant.id).toArray().length)throw Error('CLI workload grants require delegation-aware redemption');
    // Compare and consume in one transaction; parallel requests cannot exceed
    // the use limit while Cloudflare resolves an asynchronous binding.
    const reservedUse=this.ctx.storage.transactionSync(() => {
      const row = this.#sql
        .exec<{
          uses: number;
          expires: number;
        }>("SELECT uses,expires FROM managed_grants WHERE id = ?", grant.id)
        .toArray()[0];
      if (!row || row.expires <= Date.now() || row.uses >= 100)
        throw Error("Workload grant unavailable");
      this.#sql.exec(
        "UPDATE managed_grants SET uses = uses + 1 WHERE id = ?",
        grant.id,
      );
      return row.uses+1;
    });
    const values: Record<string, string> = {};
    const observed:{name:string;binding:string;version:number}[]=[];
    for (const name of JSON.parse(grant.names) as string[]) {
      const row = this.#sql
        .exec<{
          binding: string;
          version:number;
        }>("SELECT binding,version FROM secret_references WHERE name = ?", name)
        .toArray()[0];
      if (!row) throw Error("Secret reference unavailable");
      observed.push({name,...row});
      values[name] = await bindingFor(this.env, s, name, row.binding).get();
      if (typeof values[name] !== "string")
        throw Error("Cloudflare secret unavailable");
    }
    if(authority){const expiresAt=await authority.authorize(),now=Date.now();if(!Number.isSafeInteger(expiresAt)||expiresAt<=now||expiresAt>now+30000)throw Error('Workload authorization expired or unavailable');}
    this.ctx.storage.transactionSync(()=>{
      const current=this.#sql.exec<{actor:string;names:string;expires:number;uses:number}>('SELECT actor,names,expires,uses FROM managed_grants WHERE id=?',grant.id).toArray()[0];
      if(!current||current.actor!==grant.actor||current.names!==grant.names||current.expires!==grant.expires||current.expires<=Date.now()||current.uses<reservedUse||current.uses>100)throw Error('Workload grant changed before delivery');
      for(const ref of observed){const current=this.#sql.exec<{binding:string;version:number}>('SELECT binding,version FROM secret_references WHERE name=?',ref.name).toArray()[0];if(!current||current.binding!==ref.binding||current.version!==ref.version)throw Error('Secret reference changed before delivery');}
    });
    this.#audit({ ...s, actor: `workload:${grant.id}` }, "read", grant.id);
    await this.#schedule();
    return { values };
  }
}
export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
};
