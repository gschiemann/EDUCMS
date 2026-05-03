'use client';

/**
 * AllergyLegendWidget — small icon legend explaining dietary chips.
 *
 * Pairs with MenuBoardWidget — when the menu shows (V) / (GF) / (DF)
 * style chips, this widget gives guests the legend in a compact strip.
 * Designed to live at the bottom or in a sidebar of a menu board, NOT
 * as a hero widget.
 *
 * Each entry is a small chip with code + label + emoji icon. Operators
 * can add custom entries via config. A solid default set covers the
 * common Big-8 allergens + dietary restrictions.
 *
 * Defensive: items can be array OR omitted (use defaults). No widget
 * reads a string-only schedule field.
 *
 * Widget type: RESTAURANT_ALLERGY_LEGEND
 */

export interface AllergyLegendEntry {
  code: string;     // e.g. 'V', 'GF'
  label: string;    // e.g. 'Vegan', 'Gluten-free'
  emoji?: string;   // small icon
}

export interface AllergyLegendConfig {
  /** Optional title above the legend strip. Default 'DIETARY GUIDE'. */
  title?: string;
  /** Custom legend entries; if absent, defaults are shown. */
  entries?: AllergyLegendEntry[];
  /** Layout — 'horizontal' (strip) or 'grid' (2-col card). Default 'horizontal'. */
  layout?: 'horizontal' | 'grid';
  /** Background tone — 'cream' (default) or 'charcoal'. */
  theme?: 'cream' | 'charcoal';
  /** Accent color for the codes. */
  accentColor?: string;
}

const DEFAULT_ENTRIES: AllergyLegendEntry[] = [
  { code: 'V',   label: 'Vegan',          emoji: '🌱' },
  { code: 'VG',  label: 'Vegetarian',     emoji: '🥬' },
  { code: 'GF',  label: 'Gluten-free',    emoji: '🌾' },
  { code: 'DF',  label: 'Dairy-free',     emoji: '🥛' },
  { code: 'NF',  label: 'Nut-free',       emoji: '🥜' },
  { code: '🌶',  label: 'Spicy',          emoji: '🌶️' },
];

export function AllergyLegendWidget({
  config,
  live: _live,
}: {
  config?: AllergyLegendConfig;
  live?: boolean;
}) {
  const c: AllergyLegendConfig = config || {};
  const title = c.title || 'DIETARY GUIDE';
  const layout = c.layout || 'horizontal';
  const theme = c.theme || 'cream';
  const accent = c.accentColor || (theme === 'charcoal' ? '#e8b94a' : '#7a1f1f');
  const entries = (Array.isArray(c.entries) && c.entries.length > 0) ? c.entries : DEFAULT_ENTRIES;

  const bg = theme === 'cream' ? '#fbf6ee' : '#1a1714';
  const ink = theme === 'cream' ? '#1a1714' : '#fbf6ee';
  const subInk = theme === 'cream' ? 'rgba(26,23,20,0.65)' : 'rgba(251,246,238,0.65)';
  const itemBg = theme === 'cream' ? 'rgba(26,23,20,0.04)' : 'rgba(251,246,238,0.06)';

  return (
    <div className={`ral-root ral-${layout}`} style={{ background: bg, color: ink, ['--ral-accent' as string]: accent } as React.CSSProperties}>
      <style>{CSS}</style>

      {title && <div className="ral-title" style={{ color: subInk }}>{title}</div>}

      <div className="ral-grid">
        {entries.map((e, i) => (
          <div key={i} className="ral-item" style={{ background: itemBg }}>
            <div className="ral-code">{e.code}</div>
            <div className="ral-label">{e.label}</div>
            {e.emoji && <div className="ral-emoji" aria-hidden>{e.emoji}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700;800&display=swap');

.ral-root {
  position: absolute; inset: 0;
  overflow: hidden;
  font-family: 'Inter', system-ui, sans-serif;
  container-type: size;
  display: flex; flex-direction: column;
  padding: clamp(8px, 1.6cqh, 18px) clamp(12px, 2.2cqw, 24px);
  gap: clamp(4px, 0.8cqh, 10px);
}

.ral-title {
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(10px, 1.6cqh, 16px);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  margin-bottom: clamp(2px, 0.4cqh, 4px);
}

.ral-grid {
  flex: 1;
  display: grid;
  gap: clamp(4px, 0.8cqw, 10px);
  min-height: 0;
}
.ral-horizontal .ral-grid {
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, 1fr);
  align-content: center;
}
.ral-grid .ral-item {
  display: flex; align-items: center; gap: clamp(4px, 0.8cqw, 9px);
  padding: clamp(4px, 0.9cqh, 9px) clamp(7px, 1.3cqw, 13px);
  border-radius: clamp(4px, 0.6cqh, 8px);
  border: 1px solid currentColor;
  border-color: rgba(0,0,0,0.06);
  min-width: 0;
}
.ral-grid {
  /* When layout=grid, render as auto-fit grid with min size */
}
.ral-grid:not(.ral-horizontal-flag) {
  grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
}

.ral-code {
  flex-shrink: 0;
  font-family: 'Bebas Neue', sans-serif;
  font-weight: 700;
  font-size: clamp(11px, 2cqh, 20px);
  letter-spacing: 0.04em;
  color: var(--ral-accent, #7a1f1f);
  padding: clamp(1px, 0.2cqh, 2px) clamp(4px, 0.7cqw, 7px);
  border-radius: 3px;
  border: 1.5px solid var(--ral-accent, #7a1f1f);
  line-height: 1;
  min-width: clamp(20px, 4cqw, 32px);
  text-align: center;
}
.ral-label {
  flex: 1;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: clamp(9px, 1.5cqh, 14px);
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ral-emoji {
  flex-shrink: 0;
  font-size: clamp(11px, 1.8cqh, 16px);
  line-height: 1;
}
`;
