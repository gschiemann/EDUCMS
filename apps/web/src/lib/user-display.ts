/**
 * user-display.ts — single source of truth for "how do we say this
 * user's name?" Used by the dashboard greeting, sidebar header, top
 * toolbar, audit log, etc.
 *
 * Operator (2026-05-11): "let's say Hi Greg not gschiemann."
 *
 * Resolution order:
 *   1. firstName (if explicitly set)
 *   2. firstName + lastName combined (for full-name surfaces)
 *   3. email-prefix capitalized (legacy fallback — preserved so
 *      accounts that haven't filled in their name still get a
 *      friendlier-than-"gschiemann" greeting)
 *   4. "there" (final fallback for guest / null user)
 *
 * Keep this pure + dependency-free so it can be called from
 * components, server functions, and tests interchangeably.
 */

type NamedUser = {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
} | null | undefined;

/** First name only — for "Hi, Greg" greetings. */
export function firstName(user: NamedUser): string {
  if (!user) return 'there';
  if (user.firstName && user.firstName.trim()) return user.firstName.trim();
  return emailPrefixCapitalized(user.email) || 'there';
}

/** Full display name — "Greg Schiemann" if both set; falls back to firstName + email-prefix. */
export function fullName(user: NamedUser): string {
  if (!user) return '';
  const f = (user.firstName || '').trim();
  const l = (user.lastName || '').trim();
  if (f && l) return `${f} ${l}`;
  if (f) return f;
  if (l) return l;
  return emailPrefixCapitalized(user.email) || (user.email || '');
}

/** 1-2 character avatar initials — "GS" / "G" / "GS" (from email). */
export function initials(user: NamedUser): string {
  if (!user) return '?';
  const f = (user.firstName || '').trim();
  const l = (user.lastName || '').trim();
  if (f && l) return (f[0] + l[0]).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  if (user.email) {
    const local = user.email.split('@')[0] || '';
    // Try first.last @ pattern → "FL", else first 2 chars
    const parts = local.split(/[._-]/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return local.slice(0, 2).toUpperCase();
  }
  return '?';
}

function emailPrefixCapitalized(email: string | null | undefined): string {
  if (!email) return '';
  const local = email.split('@')[0] || '';
  const bit = local.split(/[._-]/)[0];
  if (!bit) return '';
  return bit.charAt(0).toUpperCase() + bit.slice(1);
}
