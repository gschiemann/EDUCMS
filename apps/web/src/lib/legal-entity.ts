/**
 * ONE place for the facts the public legal pages (/terms, /privacy, /dpa,
 * /ferpa, /coppa, /terms/eula) state about the company itself.
 *
 * Every page reads the legal entity name and mailing address from here, so
 * changing the strings below updates every document at once. Do not hard-code
 * the entity or address into a page.
 *
 * The contact addresses: privacy@, security@ and support@ are forwarded
 * (Forward Email, 2026-10-10). There is no legal@ mailbox, so legal notices
 * go to support@ (2026-10-22) — never name an address that is not forwarded.
 *
 * Nothing here is legal advice; the documents need attorney review.
 */

export const LEGAL_ENTITY = {
  /**
   * The contracting legal entity. Owner rule (2026-10-11): customers see
   * "VenueOS" everywhere; this name appears ONCE per legal document, in the
   * clause that names the parties (required for an enforceable contract and
   * for identifying the data controller). Never in footers, emails, invoices
   * or contact blocks.
   */
  companyLegalName: 'Twin Oaks Farm & Tech LLC',
  /** Postal address for legal notices. */
  mailingAddress: '7575 State Highway 134 E., Columbia, AL 36319',
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
 */
export const GOVERNING_STATE = 'Alabama';

export const LEGAL_CONTACTS = {
  // Legal notices (/terms, /terms/eula). legal@ is not a forwarded alias —
  // support@ is, so notices sent here reach a person (2026-10-22).
  legal: 'support@venue-os.app',
  privacy: 'privacy@venue-os.app',
  security: 'security@venue-os.app',
  support: 'support@venue-os.app',
  sales: 'sales@venue-os.app',
} as const;

/** Shown as "Last updated" on /terms, /privacy, /dpa, /ferpa, /coppa and /terms/eula. */
export const LEGAL_LAST_UPDATED = 'October 22, 2026';

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
 * checked against the code / env names on 2026-10-11, and re-checked on
 * 2026-10-22 (Census geocoder fallback in `apps/api/src/geocoding`; Open-Meteo
 * and ipapi.co are called by weather widgets on the screen itself, see
 * `components/widgets/lib/useLiveTemplateData.ts`) (see
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
    name: 'U.S. Census Bureau Geocoder',
    purpose: 'Fallback address lookup (the address being looked up only)',
    location: 'United States',
    when: 'Only when the primary address lookup cannot find an address',
  },
  {
    name: 'Open-Meteo',
    purpose:
      'Weather forecasts for weather widgets, requested by the screen itself (the screen\'s network address and the widget\'s location)',
    location: 'Europe',
    when: 'Only on screens that show a weather widget',
  },
  {
    name: 'ipapi.co (Kloudend)',
    purpose:
      'Approximate city from a screen\'s network address, so a weather widget with no location set can show local weather',
    location: 'United States',
    when: 'Only when a weather widget has no location set',
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
