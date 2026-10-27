import type { Owner } from "../types";

export type SigningKind = "ssh" | "pgp";
export interface ParsedSigningKey { id:string; kind:SigningKind; fingerprint:string; publicKey:string; aliases:string[] }
export interface SigningKey extends ParsedSigningKey { label:string; owner:Owner; emails:string[]; createdAt:number; revokedAt:number|null }
export type PublicSigningKey = Omit<SigningKey,"aliases">;
export interface SignatureReceipt { commit:string; objectDigest:string; key:string; fingerprint:string; kind:SigningKind; signer:Owner; email:string; verifiedAt:number }
export interface SignatureResult { verified:boolean; reason:string|null; receipt?:SignatureReceipt }
export interface SignedPayload { payload:Uint8Array; signature:string; email:string; kind:SigningKind }
export interface SignatureProof { verified:boolean; checked:number; reason:string|null; creationBranches?:string }
export interface SigningKeyList { account:string; keys:PublicSigningKey[]; signingEmail:string; emails:string[] }
export interface SignatureGate { required:boolean; verified:boolean; checked:number; error:string|null }
