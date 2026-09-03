/**
 * lazy-widget contract (P1-1, 2026-09-03).
 *
 * These four behaviours are the reason the widget split is safe to run on a
 * wall screen, so each one is asserted rather than assumed:
 *
 *   1. The proxy renders NOTHING until its chunk resolves, then renders the
 *      real component with byte-identical props. Rendering a guess would mean
 *      a frame of the wrong widget on a live screen.
 *   2. A FAILED load never becomes permanent. `React.lazy` caches a rejected
 *      promise for the life of the page — a kiosk that boots a second before
 *      its uplink comes up would keep a blank zone until someone reloads it.
 *      Here the latch clears and the next attempt succeeds.
 *   3. N proxies over one module share ONE `import()`. A themed template
 *      mounts ten components from a single theme file; ten parallel fetches
 *      on a metered kiosk link would be a self-inflicted stampede.
 *   4. A module missing the named export renders null instead of throwing —
 *      the shape a stale service-worker copy of an older build has. A throw
 *      here would trip the per-zone error boundary and blank the zone
 *      permanently instead of for one retry cycle.
 */
import { render, screen, act } from '@testing-library/react';
import { lazyWidget, loadWidgetChunk, isWidgetChunkLoaded, type WidgetChunkModule } from '../lazy-widget';

function Real({ label, count }: { label: string; count: number }) {
  return <div data-testid="real">{`${label}:${count}`}</div>;
}

/** A loader whose settlement this test controls. */
function deferredLoader() {
  let resolve!: (m: WidgetChunkModule) => void;
  let reject!: (e: unknown) => void;
  let calls = 0;
  const loader = () => {
    calls += 1;
    return new Promise<WidgetChunkModule>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return {
    loader,
    resolve: (m: WidgetChunkModule) => resolve(m),
    reject: (e: unknown) => reject(e),
    get calls() {
      return calls;
    },
  };
}

/** Let the loader promise's `.then` chain and React's re-render flush. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('lazyWidget', () => {
  it('renders nothing until the chunk lands, then the real component with the same props', async () => {
    const d = deferredLoader();
    const Proxy = lazyWidget<{ label: string; count: number }>(d.loader, 'Real');

    render(<Proxy label="Cafeteria" count={3} />);
    expect(screen.queryByTestId('real')).toBeNull();

    d.resolve({ Real });
    await flush();

    expect(screen.getByTestId('real').textContent).toBe('Cafeteria:3');
  });

  it('does not latch a failed load — the next attempt still resolves', async () => {
    const d = deferredLoader();
    const Proxy = lazyWidget<{ label: string; count: number }>(d.loader, 'Real');

    render(<Proxy label="Hallway" count={1} />);
    d.reject(new Error('offline'));
    await flush();

    // The failure resolved to null rather than rejecting, and cleared the
    // latch: a fresh call starts a NEW import instead of replaying the
    // rejection (the React.lazy trap).
    expect(isWidgetChunkLoaded(d.loader)).toBe(false);
    const callsAfterFailure = d.calls;
    const retry = loadWidgetChunk(d.loader);
    expect(d.calls).toBe(callsAfterFailure + 1);

    d.resolve({ Real });
    await act(async () => {
      await retry;
    });
    await flush();
    expect(screen.getByTestId('real').textContent).toBe('Hallway:1');
  });

  it('shares ONE import across every proxy over the same module', async () => {
    const d = deferredLoader();
    const A = lazyWidget<{ label: string; count: number }>(d.loader, 'Real');
    const B = lazyWidget<{ label: string; count: number }>(d.loader, 'Real');

    render(
      <div>
        <A label="a" count={1} />
        <B label="b" count={2} />
      </div>,
    );
    await flush();
    expect(d.calls).toBe(1);

    d.resolve({ Real });
    await flush();
    expect(screen.getAllByTestId('real').map((n) => n.textContent)).toEqual(['a:1', 'b:2']);
  });

  it('renders null (never throws) when the module lacks the named export', async () => {
    const d = deferredLoader();
    const Proxy = lazyWidget<{ label: string; count: number }>(d.loader, 'NotThere');

    render(<Proxy label="x" count={0} />);
    d.resolve({ Real });
    await flush();

    expect(screen.queryByTestId('real')).toBeNull();
  });
});
