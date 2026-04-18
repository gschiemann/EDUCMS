// Client-safe types and static metadata for the help center. Anything that
// reads from the filesystem must live in index.ts (server-only).

export type HelpCategory =
  | 'Getting Started'
  | 'Templates'
  | 'Screens'
  | 'Emergency System'
  | 'SSO'
  | 'Clever'
  | 'Billing';

export interface HelpArticle {
  slug: string;
  title: string;
  category: HelpCategory;
  updated: string;
  excerpt: string;
  body: string;
}

export const HELP_CATEGORIES: {
  name: HelpCategory;
  description: string;
  color: string;
}[] = [
  { name: 'Getting Started', description: 'Set up your district and launch your first screen.', color: 'from-indigo-500 to-violet-500' },
  { name: 'Templates', description: 'Design layouts, widgets, and reusable assets.', color: 'from-fuchsia-500 to-pink-500' },
  { name: 'Screens', description: 'Pair, group, and manage physical displays.', color: 'from-emerald-500 to-teal-500' },
  { name: 'Emergency System', description: 'Lockdown, weather, and evacuation alerts — plus safeguards.', color: 'from-red-500 to-rose-500' },
  { name: 'SSO', description: 'Connect Google, Microsoft, or any SAML/OIDC IdP.', color: 'from-sky-500 to-cyan-500' },
  { name: 'Clever', description: 'Auto-sync staff and schedules from your SIS.', color: 'from-amber-500 to-orange-500' },
  { name: 'Billing', description: 'Invoices, POs, upgrading, canceling.', color: 'from-slate-600 to-slate-800' },
];
