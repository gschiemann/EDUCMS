import { redirect } from 'next/navigation';

/**
 * /[schoolId]/emergency/broadcast — PRESERVED OLD URL (2026-10-26).
 *
 * The Broadcast page is gone. The owner, on site: "it should not get its own
 * page, add it into the emergency page area as a custom message." A typed-in
 * message is now the **Custom message** card on the Emergency page (/panic on a
 * phone; the Emergency window on the desktop), with two kinds — Info and
 * Critical — instead of three, a "Send to" line that can pick specific screens,
 * and the same 3-second hold.
 *
 * This route stays so nothing that points at it breaks — bookmarks, the
 * dashboard's old "Emergency console" button, emails, training docs. It goes
 * straight to the card: /panic?message=1 opens the Custom message sheet on
 * arrival (CustomMessageCard `openFromUrl`). A server redirect, so it works
 * before any script runs; /panic does its own sign-in check and sends a
 * signed-out visitor to /login.
 *
 * Do not delete this file without a redirect rule that replaces it.
 */
export default async function BroadcastRedirect({ params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  redirect(`/panic?schoolId=${encodeURIComponent(schoolId)}&message=1`);
}
