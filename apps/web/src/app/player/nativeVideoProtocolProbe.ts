import { readNativeVideoProtocol } from './nativeSharedVideo';

/** Document-start bridge injection can finish after React mounts. Never latch that absence forever. */
export function discoverNativeVideoProtocol(
  bridge: { has(): boolean; state(): Promise<unknown> },
  found: (protocol: 1 | 2 | 3) => void,
): () => void {
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    stopped = true;
    if (retry !== null) clearTimeout(retry);
    clearTimeout(deadline);
  };
  // Independently bound a bridge call that never resolves, as well as retries.
  const deadline = setTimeout(stop, 15_000);
  const again = () => { if (!stopped) retry = setTimeout(ask, 500); };
  const ask = async () => {
    if (stopped) return;
    try {
      if (!bridge.has()) { again(); return; }
      const raw = await bridge.state();
      if (stopped) return;
      const protocol = readNativeVideoProtocol(raw);
      if (protocol !== null) { stop(); found(protocol); return; }
    } catch { /* Still starting, or unsupported: the browser keeps playing. */ }
    again();
  };
  void ask();
  return stop;
}
