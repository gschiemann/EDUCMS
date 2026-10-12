/**
 * Show the video gate's warnings (2026-10-12) after a publish went through:
 * one plain-language toast per file and reason, at most three, each naming
 * the file and the screen(s). The publish itself succeeded — this is
 * information, never a blocker. Returns the sentences shown (tests).
 */
import { toast } from 'sonner';
import { playbackWarningText, playbackWarningsOf, type PlaybackGateT } from './playback-warning-text';

const MAX_TOASTS = 3;

export function showPlaybackWarnings(t: PlaybackGateT, responseBody: unknown): string[] {
  const warnings = playbackWarningsOf(responseBody);
  const shown: string[] = [];
  for (const w of warnings.slice(0, MAX_TOASTS)) {
    const text = playbackWarningText(t, w);
    shown.push(text);
    try {
      toast.warning(text, { duration: 15_000 });
    } catch {
      /* no toaster mounted (tests, embeds) — the words are still returned */
    }
  }
  return shown;
}
