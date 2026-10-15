import type { Metadata } from "next";
import { BlobPage } from "@/trunk/code/BlobPage";
import { joinPath, versionParam } from "@/trunk/paths";

type Props = { params: Promise<{ trunk: string; path: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { trunk, path } = await params;
  return { title: `${joinPath(path)} · ${trunk}` };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ trunk, path }, query] = await Promise.all([params, searchParams]);
  return <BlobPage trunk={trunk} path={joinPath(path)} v={versionParam(query.v)} plain={query.plain === "1"} />;
}
