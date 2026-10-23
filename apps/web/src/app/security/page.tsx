import { PublicShell } from '@/components/marketing/PublicShell';
import { SecurityPolicy } from './SecurityPolicy';

export const metadata = {
  title: 'Report a security vulnerability — VenueOS',
  description:
    'How to report a security vulnerability in VenueOS, what we commit to in return, what is in scope, and the safe harbor for good-faith research.',
};

/**
 * Vulnerability disclosure policy (2026-10-22). `/.well-known/security.txt`
 * points its `Policy:` field here. The commitments mirror the repository's
 * SECURITY.md (acknowledge in 3 business days, assess in 10, fix targets
 * 30 / 90 days) — change both together. Prerendered: listed in
 * `CSP_UNNONCEABLE_PREFIXES` (`lib/csp-script-policy.ts`).
 */
export default function SecurityPage() {
  return (
    <PublicShell>
      <SecurityPolicy />
    </PublicShell>
  );
}
