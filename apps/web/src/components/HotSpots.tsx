/** The footprint keys agents conflict on most. A hot spot is a design smell:
 *  one function everyone has to touch. */
export function HotSpots({ hot }: { hot: [string, number][] }) {
  if (!hot.length) return <p className="text-xs text-muted">No conflicts yet.</p>;
  const max = hot[0][1];
  return (
    <ul className="space-y-2">
      {hot.map(([key, n]) => (
        <li key={key} className="text-xs">
          <div className="flex justify-between gap-2">
            <span className="truncate text-ink-2" title={key}>
              {describe(key)}
            </span>
            <span className="tabular shrink-0 font-semibold text-ink">{n.toLocaleString("en-US")}</span>
          </div>
          {/* A meter: the track is a lighter step of the fill's own hue. */}
          <div className="mt-1 h-1.5 rounded-full" style={{ background: "color-mix(in srgb, var(--warning) 18%, transparent)" }}>
            <div className="h-1.5 rounded-full" style={{ width: `${(100 * n) / max}%`, background: "var(--warning)" }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function describe(key: string) {
  const body = key.slice(2);
  if (key.startsWith("d:")) return body.replace("#", " › ");
  if (key.startsWith("r:")) return `every use of ${body}`;
  if (key.startsWith("p:")) return `whether ${body} exists`;
  return key;
}
