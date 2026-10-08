import { fetchJsonBounded, headersStatusOf } from './fetchTimeout';

/** Feed the origin policy throughout playback, not only during boot.
 * HTTP refusals are reachable transport; authentication stays with callers.
 * A stalled body after headers also proves reachability. Only failures before
 * an HTTP answer may move the control plane to the existing same-origin proxy.
 */
export function createControlPlaneRequest(observer: {
  success(): void;
  failure(error: unknown): void;
}) {
  return async (...args: Parameters<typeof fetchJsonBounded>) => {
    try {
      const result = await fetchJsonBounded(...args);
      observer.success();
      return result;
    } catch (error) {
      // An emergency may deliberately cancel a routine manifest. That is
      // neither a failed origin nor evidence to reset its failure streak.
      if (args[3]?.signal.aborted) throw error;
      if (headersStatusOf(error) === null) observer.failure(error);
      else observer.success();
      throw error;
    }
  };
}
