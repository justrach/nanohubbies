import type { Owner } from "@/lib/types";
import { cn } from "@/lib/utils";

/** A person's initial. People are told apart by name, not color: the series
 *  colors are kept for the charts. */
export function Avatar({ name, size = 24, ring = false }: { name: string; size?: number; ring?: boolean }) {
  return (
    <span
      title={name}
      className={cn("grid shrink-0 place-items-center rounded-full bg-wash font-semibold text-ink", ring && "ring-2 ring-surface")}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Who is watching this trunk right now. */
export function Watchers({ watchers }: { watchers: Owner[] }) {
  if (!watchers.length) return null;
  const shown = watchers.slice(0, 5);
  return (
    <div className="flex items-center gap-2" title={`Watching: ${watchers.map((w) => w.name).join(", ")}`}>
      <div className="flex -space-x-1.5">
        {shown.map((w) => (
          <Avatar key={w.id} name={w.name} size={24} ring />
        ))}
      </div>
      <span className="text-xs text-ink-2">{watchers.length === 1 ? `${watchers[0].name} is here` : `${watchers.length} people here`}</span>
    </div>
  );
}
