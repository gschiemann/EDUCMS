/**
 * WIDGET LAB — server shell.
 *
 * The lab itself is a client component (it reads `location.search` and warms
 * the widget family chunks in an effect). This file exists only to carry the
 * route-segment config, because **`export const dynamic` is ignored in a
 * client component** — Next only honours route-segment exports in a Server
 * Component. With the config in the client file the route stayed in the
 * prerender manifest, and `check-csp-prerender.cjs` correctly failed it: a
 * prerendered route's inline scripts are built with no nonce, so under the
 * enforced script-src CSP the browser refuses them and the page renders blank.
 *
 * Dynamic is also what the lab actually needs — the measurer varies `?id=`,
 * `?w=` and `?h=` per request.
 */
export const dynamic = 'force-dynamic';

import WidgetLabClient from './WidgetLabClient';

export default function WidgetLabPage() {
  return <WidgetLabClient />;
}
