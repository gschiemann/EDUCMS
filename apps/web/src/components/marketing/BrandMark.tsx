import Link from 'next/link';

/**
 * VenueOS wordmark — the hexagonal-network mark (one filled control-plane
 * hex inside an outline hex) + the "VenueOS" wordmark in tight-tracked
 * Inter. `tone="dark"` flips the wordmark white for use on navy surfaces.
 */
export function BrandMark({
  size = 'md',
  tone = 'light',
}: {
  size?: 'sm' | 'md';
  tone?: 'light' | 'dark';
}) {
  const dim = size === 'sm' ? 22 : 26;
  const textSize = size === 'sm' ? 'text-[15px]' : 'text-[17px]';
  return (
    <Link href="/" className="inline-flex items-center gap-2.5 group">
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 32 32"
        aria-hidden
        className="group-hover:scale-105 transition-transform"
      >
        <polygon points="30,16 23,28.12 9,28.12 2,16 9,3.88 23,3.88" fill="#4f46e5" />
        <polygon points="22,16 19,21.2 13,21.2 10,16 13,10.8 19,10.8" fill="#a5b4fc" />
      </svg>
      <span
        className={`${textSize} font-semibold tracking-tight ${
          tone === 'dark' ? 'text-white' : 'text-slate-900'
        }`}
      >
        VenueOS
      </span>
    </Link>
  );
}
