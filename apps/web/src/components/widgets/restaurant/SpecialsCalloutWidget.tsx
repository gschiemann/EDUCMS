'use client';

/**
 * SpecialsCalloutWidget — "TODAY ONLY" big-type promo card.
 *
 * Single high-impact slide: huge headline, subhead, item name with
 * emoji, and a price callout. Designed to anchor a promo zone and
 * pull eyeballs from across the room.
 *
 * Visual DNA: deep red base + cream text + mustard accent. Optional
 * starburst behind the price for extra "!!!" energy. The headline
 * (e.g. "TODAY ONLY") is the controlled call-out — the operator can
 * swap it to "TUESDAY DEAL", "HAPPY HOUR", etc.
 *
 * Widget type: RESTAURANT_SPECIALS_CALLOUT
 */

export interface SpecialsCalloutConfig {
  /** Top headline — e.g. "TODAY ONLY". Default same. */
  headline?: string;
  /** Subhead under the headline — e.g. "while supplies last". */
  subhead?: string;
  /** Item name — e.g. "Smash Burger Combo". */
  itemName?: string;
  /** Item description (optional, shown small). */
  itemDesc?: string;
  /** Sale price — e.g. "$5.99". */
  price?: string;
  /** Optional struck-through original price — e.g. "$8.99". */
  originalPrice?: string;
  /** Big emoji shown next to the item name. */
  emoji?: string;
  /** Background tone — 'red' / 'charcoal' / 'mustard'. Default red. */
  theme?: 'red' | 'charcoal' | 'mustard';
}

export function SpecialsCalloutWidget({
  config,
  live: _live,
}: {
  config?: SpecialsCalloutConfig;
  live?: boolean;
}) {
  const c: SpecialsCalloutConfig = config || {};
  const headline = c.headline || 'TODAY ONLY';
  const subhead = c.subhead || 'while supplies last';
  const itemName = c.itemName || 'Smash Burger Combo';
  const itemDesc = c.itemDesc || '1/3 lb smash, fries & 22oz drink';
  const price = c.price || '$5.99';
  const originalPrice = c.originalPrice;
  const emoji = c.emoji || '🍔';
  const theme = c.theme || 'red';

  const bg =
    theme === 'red'      ? 'linear-gradient(140deg, #7a1f1f 0%, #4d0e0e 100%)' :
    theme === 'mustard'  ? 'linear-gradient(140deg, #d68a1f 0%, #a85d0a 100%)' :
                           'linear-gradient(140deg, #1a1714 0%, #2a211c 100%)';
  const accent =
    theme === 'red'      ? '#e8b94a' :
    theme === 'mustard'  ? '#fbf6ee' :
                           '#e8b94a';
  const accentSoft =
    theme === 'red'      ? '#fbf6ee' :
    theme === 'mustard'  ? '#fff' :
                           '#fbf6ee';

  return (
    <div className="rsc-root" style={{ background: bg, ['--rsc-accent' as string]: accent, ['--rsc-soft' as string]: accentSoft } as React.CSSProperties}>
      <style>{CSS}</style>

      <div className="rsc-grain" aria-hidden />
      <div className="rsc-stamp" aria-hidden>
        <svg viewBox="0 0 200 200" preserveAspectRatio="none">
          <defs>
            <radialGradient id="rsc-burst" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--rsc-accent, #e8b94a)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--rsc-accent, #e8b94a)" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="100" fill="url(#rsc-burst)" />
        </svg>
      </div>

      <div className="rsc-stack">
        {/* Headline */}
        <div className="rsc-headline">{headline}</div>
        <div className="rsc-subhead">{subhead}</div>

        {/* Big emoji + item */}
        <div className="rsc-item-row">
          <div className="rsc-emoji" aria-hidden>{emoji}</div>
          <div className="rsc-item-text">
            <div className="rsc-item-name">{itemName}</div>
            {itemDesc && <div className="rsc-item-desc">{itemDesc}</div>}
          </div>
        </div>

        {/* Price callout */}
        <div className="rsc-price-row">
          {originalPrice && (
            <div className="rsc-orig-price">
              <span>{originalPrice}</span>
              <span className="rsc-strike" aria-hidden />
            </div>
          )}
          <div className="rsc-price">{price}</div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Playfair+Display:ital,wght@1,700&family=Inter:wght@400;500;600;700;800&display=swap');

.rsc-root {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0;
  overflow: hidden;
  color: var(--rsc-soft, #fbf6ee);
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; align-items: center; justify-content: center;
  text-align: center;
}
.rsc-grain {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; z-index: 1;
  pointer-events: none;
  opacity: 0.06;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/></svg>");
  mix-blend-mode: overlay;
}
.rsc-stamp {
  position: absolute; right: -10%; top: 50%;
  transform: translateY(-50%);
  width: 80%; height: 110%;
  z-index: 0;
  pointer-events: none;
  opacity: 0.7;
}
.rsc-stamp svg { width: 100%; height: 100%; }

.rsc-stack {
  position: relative; z-index: 5;
  display: flex; flex-direction: column; align-items: center;
  gap: clamp(4px, 1cqh, 14px);
  padding: clamp(16px, 3cqh, 40px) clamp(18px, 3cqw, 44px);
  width: 100%;
}

.rsc-headline {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(32px, 11cqh, 130px);
  line-height: 0.9;
  letter-spacing: 0.04em;
  color: var(--rsc-accent, #e8b94a);
  text-shadow: 0 4px 28px rgba(0,0,0,0.45), 0 0 60px rgba(232,185,74,0.18);
  text-transform: uppercase;
  /* Slight optical correction so the bold display feels grounded */
  margin-bottom: clamp(-4px, -0.4cqh, -2px);
}
.rsc-subhead {
  font-family: 'Playfair Display', serif;
  font-style: italic;
  font-weight: 700;
  font-size: clamp(13px, 2.2cqh, 28px);
  letter-spacing: 0.02em;
  color: var(--rsc-soft, #fbf6ee);
  opacity: 0.85;
  margin-bottom: clamp(6px, 1.6cqh, 18px);
}

.rsc-item-row {
  display: flex; align-items: center; gap: clamp(10px, 2cqw, 26px);
  margin: clamp(4px, 0.8cqh, 12px) 0;
  max-width: 95%;
}
.rsc-emoji {
  font-size: clamp(40px, 14cqh, 160px);
  line-height: 1;
  filter: drop-shadow(0 6px 16px rgba(0,0,0,0.35));
  flex-shrink: 0;
}
.rsc-item-text {
  display: flex; flex-direction: column; align-items: flex-start;
  text-align: left;
  min-width: 0;
}
.rsc-item-name {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(20px, 6.5cqh, 78px);
  line-height: 1;
  letter-spacing: 0.02em;
  color: var(--rsc-soft, #fbf6ee);
}
.rsc-item-desc {
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: clamp(11px, 1.8cqh, 20px);
  margin-top: clamp(2px, 0.4cqh, 6px);
  opacity: 0.7;
}

.rsc-price-row {
  display: inline-flex; align-items: baseline; gap: clamp(8px, 1.6cqw, 22px);
  margin-top: clamp(6px, 1.4cqh, 14px);
  padding: clamp(4px, 0.8cqh, 10px) clamp(14px, 2.6cqw, 32px);
  border: 3px solid var(--rsc-accent, #e8b94a);
  border-radius: clamp(6px, 1cqh, 12px);
  background: rgba(0,0,0,0.18);
  box-shadow: 0 8px 24px rgba(0,0,0,0.3);
}
.rsc-orig-price {
  position: relative;
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(14px, 3cqh, 36px);
  color: var(--rsc-soft, #fbf6ee);
  opacity: 0.5;
  line-height: 1;
}
.rsc-strike {
  position: absolute; left: -4%; right: -4%; top: 50%;
  height: 3px;
  background: var(--rsc-accent, #e8b94a);
  transform: rotate(-8deg);
  pointer-events: none;
}
.rsc-price {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 900;
  font-size: clamp(40px, 13cqh, 150px);
  line-height: 0.9;
  letter-spacing: 0.02em;
  color: var(--rsc-accent, #e8b94a);
  text-shadow: 0 0 40px rgba(232,185,74,0.4);
}
`;
