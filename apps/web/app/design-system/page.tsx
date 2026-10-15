import type { Metadata } from "next";
import { Brand } from "@/components/Brand";
import { TopBar } from "@/components/TopBar";
import { Card, LinkButton, Pill } from "@/components/ui";
import { Button, Input } from "@/components/controls";

export const metadata: Metadata = { title: "Design system" };

const colors = [
  ["Page", "--page", "The quiet background"],
  ["Surface", "--surface", "Cards and navigation"],
  ["Ink", "--ink", "Primary content"],
  ["Brand", "--brand", "Selection and focus"],
  ["Action", "--action", "The next useful step"],
  ["Success", "--good-text", "Completed work"],
];

export default function DesignSystem() {
  return <>
    <TopBar crumbs={<span className="text-sm text-muted">Design system</span>} />
    <main className="mx-auto max-w-5xl space-y-10 px-5 py-10 sm:py-14">
      <header className="max-w-2xl space-y-4">
        <p className="text-xs font-medium text-series-1">nanohub / interface reference</p>
        <h1 className="text-4xl font-semibold tracking-tight">One shared language.</h1>
        <p className="text-sm leading-7 text-ink-2">A calm, compact place for people and coding agents. Clear hierarchy, a little blue, and enough space to follow the work. These are the same components used throughout nanohub.</p>
      </header>
      <section aria-labelledby="identity" className="space-y-4">
        <h2 id="identity" className="text-lg font-semibold tracking-tight">01 / Identity</h2>
        <Card className="flex flex-wrap items-center justify-between gap-8 p-6">
          <Brand />
          <p className="max-w-md text-sm leading-6 text-ink-2">Three commits on one shared trunk. Always lowercase, with the same mark in the app, footer, and browser tab.</p>
        </Card>
      </section>
      <section aria-labelledby="palette" className="space-y-4">
        <h2 id="palette" className="text-lg font-semibold tracking-tight">02 / Color with a purpose</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {colors.map(([label, token, detail]) => <Card key={token} className="overflow-hidden">
            <div className="h-20 border-b border-line" style={{ background: `var(${token})` }} />
            <div className="space-y-1 p-3"><h3 className="text-xs font-semibold">{label}</h3><p className="text-[11px] leading-5 text-muted">{detail}</p><code className="text-[10px] text-muted">{token}</code></div>
          </Card>)}
        </div>
        <p className="text-xs text-muted">Use the theme switch above to inspect both palettes. Status colors always come with a label.</p>
      </section>
      <section aria-labelledby="type" className="space-y-4">
        <h2 id="type" className="text-lg font-semibold tracking-tight">03 / Typography</h2>
        <Card className="grid gap-6 p-6 sm:grid-cols-2">
          <div className="space-y-3"><p className="text-2xl font-semibold tracking-tight">A workspace that reads clearly.</p><p className="text-sm leading-6 text-ink-2">Geist for navigation, conversations, and explanations. Short headings, sentence case, and comfortable line spacing.</p></div>
          <div className="space-y-3"><p className="font-mono text-sm">git push origin HEAD:refs/for/main</p><p className="text-xs leading-6 text-muted">Geist Mono for commands, hashes, and code. Tabular digits for changing counts. Keep labels compact; give body text room.</p></div>
        </Card>
      </section>
      <section aria-labelledby="controls" className="space-y-4">
        <h2 id="controls" className="text-lg font-semibold tracking-tight">04 / Controls and states</h2>
        <Card className="grid gap-8 p-6 sm:grid-cols-2">
          <div className="space-y-4"><div className="flex flex-wrap gap-2"><LinkButton href="/start" variant="primary">Create a workspace</LinkButton><LinkButton href="/dashboard">Browse workspaces</LinkButton><Button disabled>Unavailable</Button></div><p className="text-xs leading-6 text-muted">One primary action. Quiet secondary actions. Consistent 8 px corners and a visible keyboard focus ring.</p></div>
          <div className="space-y-2"><label htmlFor="sample-workspace" className="text-xs font-medium">Workspace name</label><Input id="sample-workspace" placeholder="e.g. storefront" autoComplete="off" /><p className="text-xs text-muted">Labels stay visible. Placeholder text is only an example.</p></div>
          <div className="flex flex-wrap gap-2"><Pill className="border-good-text/30 text-good-text">✓ Landed</Pill><Pill className="border-series-1/30 text-series-1">● Working</Pill><Pill>○ Waiting</Pill></div>
          <p className="text-xs leading-6 text-muted">A 4 px spacing rhythm, 12 px panel corners, restrained borders, and reduced-motion support keep the interface predictable.</p>
        </Card>
      </section>
      <footer className="border-t border-line pt-6 text-xs text-muted">Built from shared tokens and components. Changes here follow the product.</footer>
    </main>
  </>;
}
