'use client';

/**
 * RetailProductGridWidget — N-column lookbook grid.
 *
 * Editorial / boutique aesthetic. Each tile is a clean card with a
 * full-bleed product image, name in tracked uppercase, price + optional
 * sale price with strike-through, and an optional badge ribbon (NEW,
 * LIMITED, BACK IN STOCK).
 *
 * When `imageUrl` is missing we fall back to a solid swatch + emoji
 * placeholder so the layout never collapses while merchandisers wait
 * for product photography.
 *
 * Sized via container queries so the same component renders cleanly
 * on a 4K end-cap screen, a 1080p storefront window, or the gallery
 * thumbnail in the template picker.
 */

export interface RetailProduct {
  id?: string;
  name: string;
  /** "$49" or "$49.00" — accepts free-form strings for currency formatting */
  price: string;
  /** Optional sale price; renders the original price with strike-through */
  salePrice?: string;
  /** Optional product photo. Falls back to colored swatch + emoji. */
  imageUrl?: string;
  /** Solid fallback swatch when imageUrl is missing. Defaults to neutral. */
  swatchColor?: string;
  /** Emoji shown over the swatch when there's no image. */
  emoji?: string;
  /** Tiny ribbon overlay e.g. "NEW", "LIMITED", "SALE". */
  badge?: string;
  /** Optional category label rendered above the name. */
  category?: string;
}

export interface RetailProductGridConfig {
  products?: RetailProduct[];
  /** Grid columns. Defaults to 3. Clamps to 1..4. */
  columns?: number;
  /** Section heading rendered above the grid. */
  heading?: string;
  /** Subheading / tagline. */
  subheading?: string;
  /** Background. Defaults to a soft warm white. */
  bgColor?: string;
  /** Headline + body color. Defaults to deep ink. */
  inkColor?: string;
  /** Accent for badges + sale-price callouts. Defaults to muted crimson. */
  accentColor?: string;
}

const DEMO_PRODUCTS: RetailProduct[] = [
  {
    id: 'demo-1',
    name: 'Linen Trench Coat',
    price: '$248',
    salePrice: '$179',
    swatchColor: '#e6dccd',
    emoji: '🧥',
    badge: 'SALE',
    category: 'Outerwear',
  },
  {
    id: 'demo-2',
    name: 'Silk Knot Scarf',
    price: '$89',
    swatchColor: '#c9b6a0',
    emoji: '🧣',
    badge: 'NEW',
    category: 'Accessories',
  },
  {
    id: 'demo-3',
    name: 'Leather Crossbody',
    price: '$320',
    swatchColor: '#8b6f4e',
    emoji: '👜',
    category: 'Bags',
  },
];

export function RetailProductGridWidget({
  config,
}: {
  config?: RetailProductGridConfig;
  live?: boolean;
}) {
  const c: RetailProductGridConfig = config || {};
  const products = (c.products && c.products.length > 0) ? c.products : DEMO_PRODUCTS;
  const columns = Math.min(4, Math.max(1, c.columns ?? 3));
  const bg = c.bgColor || '#faf6f1';
  const ink = c.inkColor || '#1a1411';
  const accent = c.accentColor || '#9a2d2d';

  return (
    <div
      className="rpgw-root"
      style={
        {
          '--rpgw-bg': bg,
          '--rpgw-ink': ink,
          '--rpgw-accent': accent,
          '--rpgw-cols': columns,
        } as React.CSSProperties
      }
    >
      <style>{CSS}</style>

      {(c.heading || c.subheading) && (
        <header className="rpgw-header">
          {c.heading && <h2 className="rpgw-heading">{c.heading}</h2>}
          {c.subheading && <div className="rpgw-subheading">{c.subheading}</div>}
        </header>
      )}

      <div className="rpgw-grid">
        {products.slice(0, columns * 2).map((p, i) => (
          <article className="rpgw-card" key={p.id || i}>
            <div className="rpgw-image-wrap">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="rpgw-image" src={p.imageUrl} alt={p.name} />
              ) : (
                <div
                  className="rpgw-swatch"
                  style={{ background: p.swatchColor || '#e8e2d7' }}
                  aria-hidden
                >
                  <span className="rpgw-emoji">{p.emoji || '👗'}</span>
                </div>
              )}
              {p.badge && <span className="rpgw-badge">{p.badge}</span>}
            </div>
            {p.category && <div className="rpgw-category">{p.category}</div>}
            <div className="rpgw-name">{p.name}</div>
            <div className="rpgw-price-row">
              {p.salePrice ? (
                <>
                  <span className="rpgw-price-sale">{p.salePrice}</span>
                  <span className="rpgw-price-was">{p.price}</span>
                </>
              ) : (
                <span className="rpgw-price">{p.price}</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

.rpgw-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  background: var(--rpgw-bg, #faf6f1);
  color: var(--rpgw-ink, #1a1411);
  font-family: 'Inter', sans-serif;
  padding: clamp(16px, 4cqh, 56px) clamp(20px, 4cqw, 72px);
  display: flex; flex-direction: column;
  container-type: size;
  overflow: hidden;
}
.rpgw-header {
  margin-bottom: clamp(12px, 3cqh, 32px);
  text-align: center;
}
.rpgw-heading {
  font-family: 'Playfair Display', serif;
  font-weight: 700;
  font-size: clamp(28px, 7cqh, 88px);
  line-height: 1.05;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--rpgw-ink);
}
.rpgw-subheading {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(11px, 1.8cqh, 18px);
  letter-spacing: 0.35em;
  text-transform: uppercase;
  color: var(--rpgw-ink);
  opacity: 0.55;
  margin-top: clamp(6px, 1.2cqh, 14px);
}
.rpgw-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(var(--rpgw-cols, 3), 1fr);
  gap: clamp(12px, 2.5cqw, 32px);
  align-content: start;
  min-height: 0;
}
.rpgw-card {
  display: flex; flex-direction: column;
  gap: clamp(4px, 1cqh, 10px);
}
.rpgw-image-wrap {
  position: relative;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  background: #ece6dc;
}
.rpgw-image {
  width: 100%; height: 100%;
  object-fit: cover;
  display: block;
}
.rpgw-swatch {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  display: flex; align-items: center; justify-content: center;
}
.rpgw-emoji {
  font-size: clamp(48px, 14cqh, 160px);
  filter: drop-shadow(0 4px 16px rgba(0,0,0,0.12));
}
.rpgw-badge {
  position: absolute; top: clamp(6px, 1.2cqh, 14px); left: clamp(6px, 1.2cqh, 14px);
  background: var(--rpgw-accent);
  color: #ffffff;
  font-family: 'Inter', sans-serif;
  font-weight: 700;
  font-size: clamp(9px, 1.3cqh, 12px);
  letter-spacing: 0.25em;
  padding: 5px 10px;
  text-transform: uppercase;
}
.rpgw-category {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(9px, 1.2cqh, 12px);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  opacity: 0.55;
}
.rpgw-name {
  font-family: 'Playfair Display', serif;
  font-weight: 600;
  font-size: clamp(14px, 2.6cqh, 28px);
  line-height: 1.2;
  letter-spacing: 0.01em;
}
.rpgw-price-row {
  display: flex; align-items: baseline; gap: 10px;
  font-family: 'Inter', sans-serif;
}
.rpgw-price {
  font-weight: 600;
  font-size: clamp(13px, 2.2cqh, 22px);
  letter-spacing: 0.02em;
}
.rpgw-price-sale {
  font-weight: 700;
  font-size: clamp(13px, 2.2cqh, 22px);
  color: var(--rpgw-accent);
}
.rpgw-price-was {
  font-weight: 500;
  font-size: clamp(11px, 1.6cqh, 16px);
  text-decoration: line-through;
  opacity: 0.5;
}
`;
