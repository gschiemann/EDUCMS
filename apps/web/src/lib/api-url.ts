/**
 * Centralized API base URL resolution for the browser bundle.
 *
 * Production note: NEXT_PUBLIC_API_URL is baked into the build at compile
 * time by Next.js. If it isn't set, we fall back to localhost — which is
 * fine locally but manifests as "Cannot connect to the server" on any
 * deployed environment (the browser can't reach the builder's localhost).
 *
 * The helper also logs a one-time console warning when the deployed site
 * is clearly hitting localhost, so admins can diagnose a misconfigured
 * Vercel env var from the browser devtools.
 */

const FALLBACK = 'http://localhost:8080/api/v1';

export const API_URL: string = process.env.NEXT_PUBLIC_API_URL || FALLBACK;

let warned = false;

export function warnIfMisconfigured(): void {
  if (warned || typeof window === 'undefined') return;
  warned = true;

  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  const apiIsLocal = API_URL.startsWith('http://localhost') || API_URL.startsWith('http://127.');

  if (!isLocal && apiIsLocal) {
    console.error(
      '[EduSignage] NEXT_PUBLIC_API_URL is not set for this deployment — ' +
        `API calls are falling back to ${API_URL}, which the browser cannot reach. ` +
        'Set NEXT_PUBLIC_API_URL in your Vercel project settings to the Railway API URL ' +
        '(e.g. https://your-app.up.railway.app/api/v1) and redeploy.'
    );
  }
}

export function isApiFallbackInUse(): boolean {
  return API_URL === FALLBACK && !process.env.NEXT_PUBLIC_API_URL;
}

/** True when the page is served from a deployed host but the API URL points to localhost. */
export function isLikelyMisconfigured(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  const apiIsLocal = API_URL.startsWith('http://localhost') || API_URL.startsWith('http://127.');
  return !isLocal && apiIsLocal;
}
