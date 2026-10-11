/**
 * ONE place for the facts the public legal pages (/terms, /privacy, /dpa,
 * /ferpa, /coppa, /terms/eula) state about the company itself.
 *
 * ⚠️ PLACEHOLDERS — fill these in before launch (2026-10-11). The legal
 * entity name and mailing address were not known when the pages were
 * rewritten for every vertical; every page reads them from here, so changing
 * the two strings below updates every document at once. Do not hard-code the
 * entity or address into a page.
 *
 * The contact addresses: privacy@, security@ and support@ are forwarded
 * (Forward Email, 2026-10-10). legal@ was NOT among the forwarded aliases
 * confirmed on that date — add it in Forward Email (or change `legal` below)
 * before these pages go live.
 *
 * Nothing here is legal advice; the documents need attorney review.
 */

export const LEGAL_ENTITY = {
  /** The contracting legal entity, e.g. "Example Signage, Inc." */
  companyLegalName: '[COMPANY LEGAL NAME]',
  /** Postal address for legal notices. */
  mailingAddress: '[MAILING ADDRESS]',
  /** The product / brand name used throughout the documents. */
  productName: 'VenueOS',
} as const;

/**
 * The state whose law governs the Terms of Service AND the EULA, and whose
 * courts hear disputes: the state where the company is organized
 * (owner decision, 2026-10-11). ONE source for both documents — never write a
 * state name into either page. Public schools, districts, universities and
 * other government customers get the public-entity exception written next to
 * it on each page.
 *
 * ⚠️ PLACEHOLDER — set it to the state of organization (e.g. 'Delaware')
 * before launch.
 */
export const GOVERNING_STATE = '[GOVERNING STATE]';

export const LEGAL_CONTACTS = {
  legal: 'legal@venue-os.app',
  privacy: 'privacy@venue-os.app',
  security: 'security@venue-os.app',
  support: 'support@venue-os.app',
} as const;

/** Shown as "Last updated" on /terms, /privacy, /dpa, /ferpa, /coppa and /terms/eula. */
export const LEGAL_LAST_UPDATED = 'October 11, 2026';

export interface Subprocessor {
  name: string;
  purpose: string;
  /** Where the data is processed or stored. */
  location: string;
  /** When the provider receives Customer Data. */
  when: string;
}

/**
 * The providers that process Customer Data on our behalf. Each entry was
 * checked against the code / env names on 2026-10-11 (see
 * docs/research/2026-10-11-greg-decisions/02-legal-api-docs.md for the
 * evidence). Add a provider here BEFORE it receives customer data.
 */
export const SUBPROCESSORS: readonly Subprocessor[] = [
  {
    name: 'Supabase (on Amazon Web Services)',
    purpose: 'Database and file storage for accounts, settings and uploaded content',
    location: 'United States (US East)',
    when: 'Always',
  },
  {
    name: 'Railway',
    purpose: 'Application service hosting and real-time messaging to screens',
    location: 'United States (US West)',
    when: 'Always',
  },
  {
    name: 'Vercel',
    purpose: 'Web dashboard and screen-player application hosting and delivery',
    location: 'Global edge network',
    when: 'Always',
  },
  {
    name: 'GitHub',
    purpose: 'Storage of encrypted database backups',
    location: 'United States',
    when: 'Always (encrypted backups only)',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email (sign-in codes, invitations, notifications)',
    location: 'United States',
    when: 'Always',
  },
  {
    name: 'Sentry',
    purpose: 'Error monitoring, with sensitive values removed before sending',
    location: 'United States',
    when: 'Always',
  },
  {
    name: 'Stripe',
    purpose: 'Subscription billing and card payments on Stripe-hosted pages',
    location: 'United States',
    when: 'When the Customer pays by card',
  },
  {
    name: 'OpenAI, Google (Gemini) and Anthropic',
    purpose: 'AI features such as generating designs, copy and image descriptions',
    location: 'United States',
    when: 'Only when an AI feature is used with VenueOS-provided AI',
  },
  {
    name: 'Google Maps Platform',
    purpose: 'Address lookup when setting a location, and the Google Reviews app',
    location: 'United States',
    when: 'When an address is looked up or the Reviews app is used',
  },
  {
    name: 'OpenStreetMap Foundation (Nominatim)',
    purpose: 'Fallback address lookup',
    location: 'European Union / United Kingdom',
    when: 'Only when the primary address lookup is unavailable',
  },
  {
    name: 'Pexels',
    purpose: 'Stock-photo search for AI-designed boards (search words only)',
    location: 'Global',
    when: 'Only when an AI board design looks for a stock photo',
  },
  {
    name: 'Meta Platforms (Instagram, Facebook)',
    purpose: 'Displaying posts from accounts the Customer connects',
    location: 'United States',
    when: 'Only when the Customer connects an Instagram or Facebook account',
  },
];
