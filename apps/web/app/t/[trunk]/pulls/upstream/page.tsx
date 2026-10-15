import { PullsPage } from "@/trunk/pulls/PullsPage";

export default async function Page({ params }: { params: Promise<{ trunk: string }> }) {
  return <PullsPage trunk={(await params).trunk} />;
}
