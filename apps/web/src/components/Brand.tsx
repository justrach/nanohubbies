/** The same mark is used in navigation, the footer, and browser icons. */
export function BrandMark({ size = 24 }: { size?: number }) {
  // A small static SVG avoids an image-optimization request for the logo.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/favicon.svg?v=20261004" width={size} height={size} alt="" aria-hidden="true" className="brand-mark" />;
}

export function Brand() {
  return <span className="brand-lockup"><BrandMark /><span className="brand-wordmark">nanohub</span></span>;
}
