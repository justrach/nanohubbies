import type {Owner} from "../types";
import type {ParsedSigningKey,PublicSigningKey,SignatureReceipt,SigningKey} from "./types";

/** Global account-to-key binding. Revocations retain key ownership; verified
 * commit receipts are immutable and scoped to the repository that checked it. */
export class SigningKeys {
  constructor(private sql:SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS signing_keys(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS signing_key_owner ON signing_keys(owner)");
    sql.exec("CREATE TABLE IF NOT EXISTS signing_key_aliases(alias TEXT PRIMARY KEY,key_id TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS verified_commit_signatures(repository TEXT NOT NULL,commit_sha TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(repository,commit_sha))");
  }
  list(owner:string):PublicSigningKey[] {
    return this.sql.exec<{data:string}>("SELECT data FROM signing_keys WHERE owner = ? ORDER BY rowid DESC",owner).toArray().map(row=>{const {aliases,...key}:SigningKey=JSON.parse(row.data);return key;});
  }
  get(id:string):SigningKey|null {const row=this.sql.exec<{data:string}>("SELECT data FROM signing_keys WHERE id = ?",id).toArray()[0];return row?JSON.parse(row.data):null;}
  candidate(alias:string):SigningKey|null {const row=this.sql.exec<{key_id:string}>("SELECT key_id FROM signing_key_aliases WHERE alias = ?",alias).toArray()[0];return row?this.get(row.key_id):null;}
  /** parsed and allowed emails come from trusted key parsing/session data. */
  add(parsed:ParsedSigningKey,label:string,owner:Owner,emails:string[],now=Date.now()) {
    if(typeof label!=="string"||!label.trim()||label.length>100||/[\r\n\0]/.test(label))throw Error("Name the signing key using 1–100 characters");
    const prior=this.get(parsed.id);
    if(prior){if(prior.owner.id!==owner.id)throw Error("Signing key is already bound to another account");if(prior.revokedAt)throw Error("This signing key was revoked; use a new key");return prior;}
    const mine=this.list(owner.id);if(mine.length>=500||mine.filter(key=>!key.revokedAt).length>=50)throw Error("Signing key limit reached");
    if(!emails.length||emails.length>10||emails.some(email=>!/^\S+@\S+$/.test(email)||email.length>254))throw Error("No verified signing email is available");
    for(const alias of parsed.aliases)if(this.candidate(alias))throw Error("Signing key identifier is already registered");
    const key:SigningKey={...parsed,label:label.trim(),owner,emails:[...new Set(emails.map(email=>email.toLowerCase()))],createdAt:now,revokedAt:null};
    this.sql.exec("INSERT INTO signing_keys VALUES(?,?,?)",key.id,owner.id,JSON.stringify(key));
    for(const alias of key.aliases)this.sql.exec("INSERT INTO signing_key_aliases VALUES(?,?)",alias,key.id);
    return key;
  }
  revoke(owner:string,id:string,now=Date.now()) {
    const key=this.get(id);if(!key||key.owner.id!==owner)throw Error("No such signing key");
    if(key.revokedAt===null){key.revokedAt=now;this.sql.exec("UPDATE signing_keys SET data = ? WHERE id = ?",JSON.stringify(key),id);}
    return {revoked:true};
  }
  receipt(repository:string,commit:string):SignatureReceipt|null {const row=this.sql.exec<{data:string}>("SELECT data FROM verified_commit_signatures WHERE repository = ? AND commit_sha = ?",repository,commit).toArray()[0];return row?JSON.parse(row.data):null;}
  record(repository:string,commit:string,observed:SigningKey,email:string,objectDigest:string,now=Date.now()):SignatureReceipt {
    const prior=this.receipt(repository,commit);if(prior){if(prior.objectDigest!==objectDigest)throw Error("Commit bytes differ from persisted signature verification");return prior;}
    if(!/^[a-f0-9]{64}$/.test(objectDigest))throw Error("Invalid verified commit digest");
    const key=this.get(observed.id);
    if(!key||key.revokedAt!==null||key.publicKey!==observed.publicKey||key.owner.id!==observed.owner.id||!key.emails.includes(email.toLowerCase()))throw Error("Signing key changed or was revoked before verification completed");
    const receipt:SignatureReceipt={commit,objectDigest,key:key.id,fingerprint:key.fingerprint,kind:key.kind,signer:key.owner,email,verifiedAt:now};
    this.sql.exec("INSERT INTO verified_commit_signatures VALUES(?,?,?)",repository,commit,JSON.stringify(receipt));return receipt;
  }
}
