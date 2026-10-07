import { isPlausibleDeviceToken, resolveDeviceToken } from './trustGuards';

const STORAGE_KEY = 'edu_device_token';
type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface Options<T> {
  storage: () => TokenStorage | null;
  search: () => string;
  tokenFromResponse: (response: T) => string | null;
  persistNative: (token: string) => void;
  onWarning?: (reason: string) => void;
}

/** One registration owner and one accepted credential for this document.
 * localStorage remains the durable web store. Its failure must never make a
 * live page forget a server-accepted renewal and send its superseded token.
 * Native gets the same accepted mint through its existing write-only bridge.
 * No JWT claims here grant trust; every request is verified by the API.
 */
export function createDeviceTokenSession<T>(options: Options<T>) {
  let acceptedToken: string | null = null;
  let generation = 0;
  let allowBootstrap = true;
  let paused = false;
  let inFlight: Promise<T | null> | null = null;
  const warn = options.onWarning ?? (() => {});
  const storage = () => {
    try { return options.storage(); } catch { return null; }
  };

  const read = (): string | null => {
    if (acceptedToken) return acceptedToken;
    if (!allowBootstrap) return null;
    return resolveDeviceToken({ storage: storage(), search: options.search(), onReject: warn });
  };

  const persist = (token: string) => {
    if (!isPlausibleDeviceToken(token)) throw new Error('Registration returned a malformed device credential');
    acceptedToken = token.trim();
    const durable = storage();
    let saved = false;
    try {
      durable?.setItem(STORAGE_KEY, acceptedToken);
      saved = durable?.getItem(STORAGE_KEY) === acceptedToken;
    } catch { /* acceptedToken is still usable for every live request */ }
    if (!saved) {
      // A quota failure or silently dropped write can leave the OLD token
      // behind. Remove only that obsolete credential, so the next native
      // reload can bootstrap from its newly persisted token instead.
      try {
        if (durable?.getItem(STORAGE_KEY) !== acceptedToken) durable?.removeItem(STORAGE_KEY);
      } catch { /* inaccessible storage cannot defeat the live credential */ }
      warn('credential-persistence-failed');
    }
    try { options.persistNative(acceptedToken); } catch { warn('native-credential-persistence-failed'); }
  };

  const register = (request: (priorToken: string | null) => Promise<T>): Promise<T | null> => {
    if (paused) return Promise.resolve(null);
    // Boot, pairing exchange, 401 recovery and proactive renewal share
    // this flight. They cannot fork epochs or reorder accepted responses.
    if (inFlight) return inFlight;
    const owner = generation;
    const attempt = Promise.resolve().then(() => {
      if (owner !== generation) return null;
      return request(read());
    }).then((response) => {
      if (owner !== generation || response === null) return null;
      const token = options.tokenFromResponse(response);
      if (token) persist(token);
      return response;
    }).finally(() => {
      // A retired flight must not release a new pairing cycle's owner.
      if (inFlight === attempt) inFlight = null;
    });
    inFlight = attempt;
    return attempt;
  };

  const invalidate = () => {
    generation += 1;
    paused = true;
    inFlight = null;
    acceptedToken = null;
    // The URL belongs to the retired identity, too. A React-only re-pair
    // must not re-adopt it after clearing storage.
    allowBootstrap = false;
    try { storage()?.removeItem(STORAGE_KEY); } catch { /* best effort */ }
  };

  // Only the local teardown owner starts a fresh React-only pairing cycle.
  // A native unpair reloads the document and creates its own new session.
  const resume = () => { paused = false; };
  return { read, register, invalidate, resume };
}
