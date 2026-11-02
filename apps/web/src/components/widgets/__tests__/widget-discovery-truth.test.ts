import '@/components/widgets/variants-register';
import { listVariants } from '@/components/widgets/variants';
import { widgetDataCapability } from '@/components/widgets/widget-data-capabilities';
import { HIDDEN_UNLICENSED_DATA_WIDGETS } from '@/components/widgets/widget-discovery';

describe('widgets with no live data source', () => {
  const hidden = [...HIDDEN_UNLICENSED_DATA_WIDGETS];
  it('covers markets, flights, entered news and entered scores', () => {
    for (const id of ['stock-ticker', 'crypto-ticker', 'departures-board', 'flight-status-hero', 'news-headlines', 'sports-scoreboard']) {
      expect(hidden).toContain(id);
    }
  });
  it('are absent from the picker but still registered for saved boards', () => {
    const shown = new Set(listVariants().map((v) => v.id));
    const all = new Set(listVariants({ includeHidden: true }).map((v) => v.id));
    for (const id of hidden) {
      expect(shown.has(id)).toBe(false);
      expect(all.has(id)).toBe(true);
    }
  });
  it('tell the builder there is no live data source', () => {
    for (const id of hidden) {
      expect(widgetDataCapability('LIVE_DATA', id)?.label).toBe('This widget has no live data source.');
    }
  });
});
