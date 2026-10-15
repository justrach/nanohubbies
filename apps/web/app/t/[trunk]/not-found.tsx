import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-ink">Not here</h1>
      <p className="mt-2 text-sm text-ink-2">No such trunk, or nothing at that path or version in it.</p>
      <Link href="/" className="mt-6 inline-block text-sm text-series-1 hover:underline">
        Every trunk
      </Link>
    </main>
  );
}
