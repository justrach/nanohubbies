import type { Metadata } from "next";
import { IssuesView } from "../../../client";

type Props = { params: Promise<{ trunk: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Issues · ${(await params).trunk}` };
}

export default function Page() {
  return <IssuesView />;
}
