import type { Metadata } from "next";
import { CodePage } from "@/trunk/code/CodePage";
import { versionParam } from "@/trunk/paths";

type Props = { params: Promise<{ trunk: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: (await params).trunk };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ trunk }, query] = await Promise.all([params, searchParams]);
  return <CodePage trunk={trunk} path="" v={versionParam(query.v)} />;
}
