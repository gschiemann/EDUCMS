import { PublicShell } from '@/components/marketing/PublicShell';
import { SecurityPolicy } from './SecurityPolicy';

export const metadata = {
  title: 'Report a security issue — VenueOS',
  description:
    'How to report a security issue in VenueOS privately, what to send, what we commit to (an acknowledgement within 2 business days), and the safe harbor for good-faith research.',
};

/**
 * "Report a security issue" — the vulnerability disclosure page (2026-10-22,
 * redesigned 2026-10-24). `/.well-known/security.txt` points its `Policy:`
 * field here, and the public footer, the sign-in and sign-up footers and
 * SECURITY.md all link it. The commitments mirror the repository's
 * SECURITY.md (acknowledge in 2 business days, assess in 10, fix targets
 * 30 / 90 days) — change both together; `security-text.test.ts` reads both.
 * Prerendered: listed in `CSP_UNNONCEABLE_PREFIXES` (`lib/csp-script-policy.ts`).
 */
export default function SecurityPage() {
  return (
    <PublicShell>
      <SecurityPolicy />
    </PublicShell>
  );
}
