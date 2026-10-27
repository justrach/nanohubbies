/** The same mark is used in navigation, the footer, and browser icons. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="brand-mark">
      <rect width="64" height="64" rx="14" fill="var(--action)" />
      <g fill="var(--action-ink)">
        <circle cx="16" cy="32" r="5" />
        <circle cx="32" cy="32" r="5" />
        <circle cx="48" cy="32" r="5" />
      </g>
    </svg>
  );
}

export function Brand() {
  return <span className="brand-lockup"><BrandMark /><span className="brand-wordmark">nanohub</span></span>;
}
