import type { Metadata } from "next";
import { CommitsPage } from "@/trunk/history/CommitsPage";
import { versionParam } from "@/trunk/paths";

type Props = { params: Promise<{ trunk: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Commits · ${(await params).trunk}` };
}

export default async function Page({ params, searchParams }: Props) {
  const [{ trunk }, query] = await Promise.all([params, searchParams]);
  return <CommitsPage trunk={trunk} from={versionParam(query.from)} />;
}
