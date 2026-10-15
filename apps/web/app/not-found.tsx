import Link from "next/link";
import { TopBar } from "@/components/TopBar";

export default function NotFound() {
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-xl px-5 py-24 text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Not here</h1>
        <p className="mt-2 text-sm text-ink-2">Nothing lives at this address.</p>
        <Link href="/" className="mt-6 inline-block text-sm text-series-1 hover:underline">
          The front page
        </Link>
      </main>
    </div>
  );
}
