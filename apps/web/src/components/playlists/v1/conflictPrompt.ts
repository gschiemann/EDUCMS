"use client";

/**
 * Ask the "one screen, two playlists" question (2026-10-24, launch QA U15).
 *
 * Every door that can put a playlist on a screen already running another one
 * (the new-playlist wizard, Add screens, the Publish sheet, a screen's power
 * button) asks through here, so they all answer the same way:
 *
 *   - a plain overlap → "Replace on N screens?" — Replace / Cancel, as before;
 *   - a TIME-LIMITED playlist landing on an ALWAYS-ON one → "Keep both"
 *     (the default and the focused button: the always-on one keeps playing
 *     outside the new playlist's hours, so the screen is never blank),
 *     "Replace everything" (switch the always-on one off there), or Cancel.
 *
 * `allowReplaceEverything: false` drops the second answer — an Editor's
 * publish is a draft, and the approval that makes it live always keeps the
 * always-on playlist, so offering "Replace everything" there would promise
 * something nothing would do.
 */
import { appChoose, appConfirm } from '@/components/ui/app-dialog';
import type { ConflictPrompt } from './playlistOps';

export interface ConflictAnswer {
  /** False = Cancel: nothing may be written. */
  proceed: boolean;
  /** The operator chose "Replace everything" — send `replaceAlwaysOn: true`. */
  replaceAlwaysOn: boolean;
}

export async function askScreenConflicts(
  prompt: ConflictPrompt | null,
  opts: { cancelLabel?: string; allowReplaceEverything?: boolean } = {},
): Promise<ConflictAnswer> {
  if (!prompt) return { proceed: true, replaceAlwaysOn: false };
  if (prompt.alternateLabel && opts.allowReplaceEverything !== false) {
    const choice = await appChoose({
      title: prompt.title,
      message: prompt.message,
      tone: 'warn',
      confirmLabel: prompt.confirmLabel,
      alternateLabel: prompt.alternateLabel,
      ...(opts.cancelLabel ? { cancelLabel: opts.cancelLabel } : {}),
    });
    if (choice === 'cancel') return { proceed: false, replaceAlwaysOn: false };
    return { proceed: true, replaceAlwaysOn: choice === 'alternate' };
  }
  const ok = await appConfirm({
    title: prompt.title,
    message: prompt.message,
    tone: 'warn',
    confirmLabel: prompt.confirmLabel,
    ...(opts.cancelLabel ? { cancelLabel: opts.cancelLabel } : {}),
  });
  return { proceed: ok, replaceAlwaysOn: false };
}
