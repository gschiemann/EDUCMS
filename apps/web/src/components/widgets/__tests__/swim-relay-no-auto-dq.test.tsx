/**
 * K-12 launch audit F26 — the relay exchange board is a display, never an
 * official. It used to print "DQ" beside ANY negative exchange time on its
 * own; a relay takeoff is the officials' call (and a pad reading inside the
 * allowed tolerance is no early takeoff at all). Now the exchange time
 * shows exactly as typed and DQ appears only on a leg marked disqualified.
 * Proven on both surfaces (builder and a real screen).
 */
import { render, screen } from '@testing-library/react';
import { WidgetPreview, warmVariantRegistry } from '../WidgetRenderer';
import { warmAllWidgetFamilies } from '../widget-families';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

beforeAll(async () => {
  await warmAllWidgetFamilies();
  await warmVariantRegistry();
});

const LEGS = [
  { legName: 'Leg 1 — Back', swimmer: 'A. Lee', split: '27.80', cumulative: '27.80', exchange: '0.18' },
  { legName: 'Leg 2 — Breast', swimmer: 'B. Cruz', split: '31.42', cumulative: '59.22', exchange: '-0.02' },
  { legName: 'Leg 3 — Fly', swimmer: 'C. Diaz', split: '28.95', cumulative: '1:28.17', exchange: '-0.11', dq: true },
  { legName: 'Leg 4 — Free', swimmer: 'D. Moss', split: '26.60', cumulative: '1:54.77', exchange: '' },
];

function renderRelay(surface?: 'player') {
  return render(
    <div style={{ position: 'relative', width: 800, height: 450 }}>
      <WidgetPreview
        widgetType="SWIM_RELAY_EXCHANGE"
        config={{ legs: LEGS, teamName: 'EAGLES A' }}
        width={100}
        height={100}
        live={surface === 'player'}
        renderSurface={surface}
      />
    </div>,
  );
}

describe.each([['builder', undefined], ['real screen', 'player' as const]])(
  'SWIM_RELAY_EXCHANGE on the %s',
  (_label, surface) => {
    it('a negative exchange is shown as typed, never turned into DQ by the board', async () => {
      renderRelay(surface);
      expect(await screen.findByText('-0.02')).toBeInTheDocument();
      expect(screen.queryByText('-0.02 DQ')).not.toBeInTheDocument();
      expect(screen.getByText('0.18')).toBeInTheDocument();
    });

    it('DQ appears only on the leg the operator marked disqualified', async () => {
      renderRelay(surface);
      expect(await screen.findByText('-0.11 DQ')).toBeInTheDocument();
      expect(screen.getAllByText(/DQ$/)).toHaveLength(1);
    });
  },
);
