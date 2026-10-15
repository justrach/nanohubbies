import type { Metadata } from "next";
import { LiveView } from "../../../client";

type Props = { params: Promise<{ trunk: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `Live · ${(await params).trunk}` };
}

export default function Page() {
  return <LiveView />;
}
