import {CliAuthorize} from "@/settings/CliAuthorize";
export const metadata={title:"Authorize CLI"};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams;
  return <CliAuthorize initialCode={typeof params.code==="string"?params.code:""} signInFailed={typeof params.error==="string"}/>;
}
