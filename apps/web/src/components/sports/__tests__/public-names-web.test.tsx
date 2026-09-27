/**
 * K-12 sports launch, lane B3 (2026-09-27) — the web side of a withheld name.
 *
 * The API decides what a public screen may say about a student
 * (apps/api/src/sports/student-privacy.spec.ts). When it withholds a name the
 * board payload simply carries none, and the screens must then read as
 * finished sentences — never a stand-in like "PLAYER", never a verb with no
 * subject ("… LEADS THE FIELD").
 */
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { RenderSurfaceProvider } from '@/components/widgets/render-surface';
import { publicLeaderLabel } from '@/components/widgets/sports/StadiumMeetBoardWidget';
import { CtsAnnouncementWidget } from '@/components/widgets/sports/CtsRibbonWidgets';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const realOffsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
const realOffsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
const realFetch = global.fetch;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 120 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1600 });
});
afterAll(() => {
  if (realOffsetH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetH);
  if (realOffsetW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetW);
  global.fetch = realFetch;
});
afterEach(cleanup);

describe('the meet board leader line', () => {
  it('names the student when the school allows it', () => {
    expect(publicLeaderLabel({ name: 'Jordan Lee', lane: 4 })).toBe('JORDAN LEE');
  });

  it('names the lane when the name is withheld', () => {
    expect(publicLeaderLabel({ name: '', lane: 4 })).toBe('LANE 4');
    expect(publicLeaderLabel({ name: '   ', lane: 2 })).toBe('LANE 2');
  });

  it('never leaves the sentence without a subject', () => {
    expect(publicLeaderLabel({ name: null, lane: null })).toBe('THE LEADER');
    expect(publicLeaderLabel({ name: undefined, lane: 0 })).toBe('THE LEADER');
  });
});

describe('the ribbon starting-lineup reel', () => {
  function mockBoard(roster: Array<Record<string, unknown>>) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeTeam: 'EAGLES', awayTeam: 'HAWKS', roster }),
    }) as unknown as typeof fetch;
  }

  function mountReel() {
    return render(
      <RenderSurfaceProvider surface="player">
        <div style={{ position: 'relative', width: 1600, height: 120 }}>
          <CtsAnnouncementWidget
            config={{
              dataSource: 'auto',
              gameId: 'game-000000000001',
              // Only the per-player line, so the first entry on screen is it.
              autoTemplates: { homeLineup: '', awayLineup: '', closer: '' },
            }}
          />
        </div>
      </RenderSurfaceProvider>,
    );
  }

  it('a student whose name is withheld is announced by number — never as "PLAYER"', async () => {
    mockBoard([{ id: 'r1', team: 'home', name: '', number: '7', position: null, photoUrl: null }]);
    mountReel();
    expect(await screen.findByText('NOW IN · #7')).toBeTruthy();
    expect(document.body.textContent || '').not.toMatch(/PLAYER/);
  });

  it('a named student is announced by name', async () => {
    mockBoard([{ id: 'r1', team: 'home', name: 'Jordan Lee', number: '7', position: null, photoUrl: null }]);
    mountReel();
    expect(await screen.findByText('NOW IN · #7 JORDAN LEE')).toBeTruthy();
  });
});
