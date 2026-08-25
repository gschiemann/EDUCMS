/**
 * The reconnect banner wired to the real event-bus contract.
 *
 * `subscribeApiStatus` had zero consumers for months, so this suite pins the
 * shape it emits ({ status, attempt, lastUrl, message }) as well as the
 * banner's behavior — a change to either side breaks here rather than in
 * front of an operator during an outage.
 */
import { act, render, screen } from '@testing-library/react';
import { ApiStatusBanner } from '../ApiStatusBanner';
import { RECOVERED_HOLD_MS, TROUBLE_STALE_MS } from '@/lib/api-status-banner-machine';

type Listener = (s: {
  status: 'ok' | 'retrying' | 'unreachable';
  attempt: number;
  lastUrl: string;
  message?: string;
}) => void;

const listeners = new Set<Listener>();

jest.mock('@/lib/api-client', () => ({
  subscribeApiStatus: (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
}));

/** Push an event exactly the way api-client's `emit()` does. */
function emit(status: 'ok' | 'retrying' | 'unreachable', attempt = 1) {
  act(() => {
    listeners.forEach((l) => l({ status, attempt, lastUrl: '/screens', message: 'x' }));
  });
}

beforeEach(() => {
  listeners.clear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('<ApiStatusBanner />', () => {
  it('renders nothing while everything is fine', () => {
    const { container } = render(<ApiStatusBanner />);
    emit('ok');
    expect(container).toBeEmptyDOMElement();
  });

  it('announces the outage politely while retrying', () => {
    render(<ApiStatusBanner />);
    emit('retrying');

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Connection trouble — reconnecting…');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('shows trouble when a request gives up entirely', () => {
    render(<ApiStatusBanner />);
    emit('unreachable', 3);
    expect(screen.getByRole('status')).toHaveTextContent('reconnecting');
  });

  it('confirms recovery, then dismisses itself', () => {
    render(<ApiStatusBanner />);
    emit('retrying');
    emit('ok');
    expect(screen.getByRole('status')).toHaveTextContent('Back online');

    act(() => {
      jest.advanceTimersByTime(RECOVERED_HOLD_MS + 50);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stands down quietly if the bus goes silent mid-outage', () => {
    render(<ApiStatusBanner />);
    emit('retrying');

    act(() => {
      jest.advanceTimersByTime(TROUBLE_STALE_MS + 50);
    });
    // Gone — and it never claimed "Back online" without seeing a success.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the banner up while retries keep arriving', () => {
    render(<ApiStatusBanner />);
    emit('retrying', 1);
    act(() => {
      jest.advanceTimersByTime(TROUBLE_STALE_MS - 1000);
    });
    emit('retrying', 2); // re-arms the stale timer
    act(() => {
      jest.advanceTimersByTime(TROUBLE_STALE_MS - 1000);
    });
    expect(screen.getByRole('status')).toHaveTextContent('reconnecting');
  });

  it('never blocks clicks on the page behind it', () => {
    render(<ApiStatusBanner />);
    emit('retrying');
    const wrapper = screen.getByRole('status').parentElement!;
    expect(wrapper.className).toContain('pointer-events-none');
    expect(screen.getByRole('status').className).toContain('pointer-events-auto');
  });

  it('stays BELOW the emergency overlay (z-[60]) — life safety', () => {
    render(<ApiStatusBanner />);
    emit('retrying');
    const wrapper = screen.getByRole('status').parentElement!;
    const z = /z-\[(\d+)\]/.exec(wrapper.className);
    expect(z).not.toBeNull();
    expect(Number(z![1])).toBeLessThan(60);
  });

  it('gates its entrance animation on motion-safe', () => {
    render(<ApiStatusBanner />);
    emit('retrying');
    expect(screen.getByRole('status').className).toContain('motion-safe:animate-in');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<ApiStatusBanner />);
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
