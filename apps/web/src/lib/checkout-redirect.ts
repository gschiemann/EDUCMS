/**
 * checkout-redirect.ts — hand the operator to a Stripe-hosted Checkout page (2026-09-23).
 *
 * The same-tab redirect Settings → Billing uses for a subscription (`window.location.href = url`),
 * in one place so the AI board packs share it. Card entry happens on Stripe's page only
 * (PCI-SAQ-A) — nothing here ever sees a card.
 *
 * Only an `https:` URL is followed: the API hands back Stripe's own session URL, and anything else
 * is not a checkout page. Returns whether the browser was sent. `navigate` exists for tests (jsdom
 * cannot navigate); callers leave it alone.
 */
export function goToCheckout(
  url: string,
  navigate: (href: string) => void = (href) => {
    window.location.href = href;
  },
): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.protocol !== 'https:') return false;
  navigate(target.toString());
  return true;
}
