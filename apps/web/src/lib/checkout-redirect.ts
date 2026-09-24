/**
 * checkout-redirect.ts — hand the operator to a Stripe-hosted Checkout page (2026-09-23).
 *
 * The same-tab redirect Settings → Billing uses for a subscription (`window.location.href = url`),
 * in one place so the AI board packs share it and a test can stand in for it (jsdom cannot
 * navigate). Card entry happens on Stripe's page only (PCI-SAQ-A) — nothing here ever sees a card.
 *
 * Only an `https:` URL is followed: the API hands back Stripe's own session URL, and anything else
 * is not a checkout page. Returns whether the browser was sent.
 */
export function goToCheckout(url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:') return false;
  window.location.href = target.toString();
  return true;
}
