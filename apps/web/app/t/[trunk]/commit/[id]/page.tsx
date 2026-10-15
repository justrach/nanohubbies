import type { Metadata } from "next";
import { CommitPage } from "@/trunk/history/CommitPage";

type Props = { params: Promise<{ trunk: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { trunk, id } = await params;
  return { title: `${/^\d+$/.test(id) ? `v${id}` : id.slice(0, 7)} · ${trunk}` };
}

export default async function Page({ params }: Props) {
  const { trunk, id } = await params;
  return <CommitPage trunk={trunk} id={id} />;
}
