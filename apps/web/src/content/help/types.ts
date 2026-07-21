// Client-safe types and static metadata for the help center. Anything that
// reads from the filesystem must live in index.ts (server-only).

export type HelpCategory =
  | 'Getting Started'
  | 'Templates'
  | 'AI Studio'
  | 'Screens'
  | 'Emergency System'
  | 'Sports'
  | 'Integrations'
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
  { name: 'Getting Started', description: 'Set up your workspace and launch your first screen.', color: 'from-indigo-500 to-violet-500' },
  { name: 'Templates', description: 'Design layouts, import existing designs, and brand everything.', color: 'from-fuchsia-500 to-pink-500' },
  { name: 'AI Studio', description: 'Generate boards from a sentence and edit them with plain English.', color: 'from-violet-500 to-purple-500' },
  { name: 'Screens', description: 'Pair, group, and manage physical displays.', color: 'from-emerald-500 to-teal-500' },
  { name: 'Emergency System', description: 'Lockdown, weather, and evacuation alerts — plus safeguards.', color: 'from-red-500 to-rose-500' },
  { name: 'Sports', description: 'Scoreboards, ribbon boards, cues, and running a live game day.', color: 'from-green-500 to-emerald-500' },
  { name: 'Integrations', description: 'Point-of-sale menus, live prices, and connected services.', color: 'from-orange-500 to-amber-500' },
  { name: 'SSO', description: 'Connect Google, Microsoft, or any OIDC identity provider.', color: 'from-sky-500 to-cyan-500' },
  { name: 'Clever', description: 'Auto-sync staff and schedules from your SIS.', color: 'from-amber-500 to-orange-500' },
  { name: 'Billing', description: 'Invoices, POs, upgrading, canceling.', color: 'from-slate-600 to-slate-800' },
];
