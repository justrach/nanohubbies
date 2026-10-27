import { get } from "@/server/api";
import type { SigningKeyList } from "@swarm/api/review";
import { SigningKeys } from "@/settings/SigningKeys";
export const metadata={title:"Signing keys"};
export default async function Page(){
  let initial:SigningKeyList|null=null;try{initial=await get<SigningKeyList>("/api/signing-keys");}catch{/* The client offers sign-in or retry. */}
  return <SigningKeys initial={initial}/>;
}
