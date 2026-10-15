import type { Metadata } from "next";
import { PeopleTab } from "../../../client";

type Props = { params: Promise<{ trunk: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: `People · ${(await params).trunk}` };
}

export default function Page() {
  return <PeopleTab />;
}
