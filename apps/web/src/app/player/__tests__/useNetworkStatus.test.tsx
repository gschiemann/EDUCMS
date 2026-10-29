/**
 * Browser glue for the splash's network status (2026-10-26): the bounded
 * probe and the hook. The state machine itself is networkStatus.test.ts.
 */
import { act, render, screen } from '@testing-library/react';
import {
  noteNetworkAnswer,
  noteNetworkNoAnswer,
  probeReachability,
  resetNetworkMonitorForTests,
  useNetworkStatus,
} from '../useNetworkStatus';

const realFetch = global.fetch;

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}

afterEach(() => {
  global.fetch = realFetch;
  resetNetworkMonitorForTests();
  setOnline(true);
  jest.useRealTimers();
});

describe('probeReachability', () => {
  it('any HTTP answer counts — even an error page — and it never reads the body or sends credentials', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 0, type: 'opaque' });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(probeReachability('https://api.example.test/api/v1/health')).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/api/v1/health');
    expect(init).toMatchObject({ method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit' });
    expect(init.signal).toBeDefined();
  });

  it('a transport failure is false', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(probeReachability('https://api.example.test/api/v1/health')).resolves.toBe(false);
  });

  it('is bounded by its own deadline (no AbortSignal.timeout on Chromium 83)', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const pending = probeReachability('https://api.example.test/api/v1/health', undefined, 5_000);
    await jest.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toBe(false);
  });

  it('stops when the caller aborts (the surface went away)', async () => {
    global.fetch = jest.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
    const ctl = new AbortController();
    const pending = probeReachability('https://api.example.test/api/v1/health', ctl.signal);
    ctl.abort();
    await expect(pending).resolves.toBe(false);
    const already = new AbortController();
    already.abort();
    await expect(probeReachability('https://x.test/h', already.signal)).resolves.toBe(false);
  });
});

function Probe({ active }: { active: boolean }) {
  const status = useNetworkStatus(active, healthUrl);
  return <span data-testid="status">{status}</span>;
}
const healthUrl = () => 'https://api.example.test/api/v1/health';

describe('useNetworkStatus', () => {
  it('the first look decides: no link → offline at once, before any probe', () => {
    setOnline(false);
    render(<Probe active />);
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
  });

  it('follows the offline / online events and the control plane’s answers', async () => {
    global.fetch = jest.fn().mockResolvedValue({ status: 200 }) as unknown as typeof fetch;
    render(<Probe active />);
    expect(screen.getByTestId('status')).toHaveTextContent('checking');
    act(() => { noteNetworkAnswer(); });
    expect(screen.getByTestId('status')).toHaveTextContent('online');
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByTestId('status')).toHaveTextContent('offline');
    await act(async () => {
      setOnline(true);
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });
    // The online event looks at once; the probe answers.
    await screen.findByText('online');
    expect(global.fetch).toHaveBeenCalledWith('https://api.example.test/api/v1/health', expect.objectContaining({ mode: 'no-cors' }));
  });

  it('never probes while no surface asks (content on the glass)', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockResolvedValue({ status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<Probe active={false} />);
    act(() => { noteNetworkNoAnswer(); });
    await act(async () => { await jest.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('status')).toHaveTextContent('checking');
  });

  it('stops watching when the surface goes away', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn().mockResolvedValue({ status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
    const view = render(<Probe active />);
    view.rerender(<Probe active={false} />);
    await act(async () => { await jest.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });
});
