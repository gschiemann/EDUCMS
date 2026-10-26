import { redirect } from 'next/navigation';

/**
 * /[schoolId]/settings/security — PRESERVED OLD URL (2026-10-26).
 *
 * "My security" (password, passkeys, two-step sign-in) moved to My account
 * (`/[schoolId]/account`) — the owner's 2026-05-11 rule that per-user
 * settings do not belong in Settings, and owner decision 1 of the 2026-10-24
 * simplification (Editors and Viewers no longer see Settings at all, but
 * every role secures its own sign-in).
 *
 * Old links keep working: sign-in prompts, emails and bookmarks that say
 * `?add=passkey` (open the add-a-passkey panel) keep the query, and a
 * `#sec-passkeys` anchor survives because a redirect without a fragment
 * keeps the browser's (My account carries the same anchor ids).
 */
export default async function SecuritySettingsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ schoolId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { schoolId } = await params;
  const sp = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    else if (typeof value === 'string') query.set(key, value);
  }
  const qs = query.toString();
  redirect(`/${schoolId}/account${qs ? `?${qs}` : ''}`);
}
