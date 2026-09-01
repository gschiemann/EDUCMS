/**
 * Which mobile shell this browser gets — and the rollback contract that
 * makes shipping a new one safe.
 *
 * Same discipline as `venueos_hq_dashboard` (Fleet Command) and
 * `venueos_screens_view` (Screens v3): a NEW DEFAULT plus a one-click
 * "Classic navigation" escape hatch that persists in this browser, needs no
 * deploy, and is reachable from inside the thing it rolls back (the More
 * sheet). Fleet-wide rollback is flipping SHELL_DEFAULT.
 *
 * THE RULE THAT COST A FIX ON 2026-08-31: never paint the wrong variant
 * first. The dashboard shipped reading its preference in an effect, so every
 * operator watched the classic surface for ~half a second before it swapped.
 * Chrome is worse than a page for this — the tab bar and header are on screen
 * for the whole session, and a nav bar that changes shape after first paint
 * reads as a bug. So callers hold `loaded` and render NOTHING until the
 * stored answer is in hand; one frame of absent chrome is invisible, one
 * frame of the WRONG chrome is not.
 *
 * A render-time `localStorage` read would avoid the frame entirely but cannot
 * be used: it does not exist during SSR, so the server would emit one shell
 * and the client another — a hydration mismatch on the app's outermost
 * furniture.
 */

import { useEffect, useState } from 'react';

export type MobileShell = 'v1' | 'classic';

export const MOBILE_SHELL_KEY = 'venueos_mobile_shell';

/** Fleet-wide rollback: flip this ONE constant. */
export const SHELL_DEFAULT: MobileShell = 'v1';

/**
 * Same-document broadcast. The header and the tab bar are sibling components
 * with no shared parent state; without this, switching from the More sheet
 * would swap the tab bar and leave the old header standing until a reload.
 */
const SHELL_EVENT = 'venueos:mobile-shell';

/** Read the stored choice. Anything unrecognized (or unreadable) → default. */
export function readMobileShell(): MobileShell {
  if (typeof window === 'undefined') return SHELL_DEFAULT;
  try {
    const v = window.localStorage.getItem(MOBILE_SHELL_KEY);
    return v === 'classic' || v === 'v1' ? v : SHELL_DEFAULT;
  } catch {
    return SHELL_DEFAULT;
  }
}

export function writeMobileShell(v: MobileShell): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MOBILE_SHELL_KEY, v);
  } catch {
    /* storage unavailable — the default stands for this session */
  }
}

/**
 * `{ shell, loaded, setShell }`.
 *
 * `loaded` is false until the stored preference has actually been consulted.
 * Chrome components MUST render null while it is false — see the header note.
 * Switching writes storage AND updates every mounted subscriber in the same
 * tick, so the header and the tab bar can never disagree about which shell
 * they are drawing.
 */
export function useMobileShell(): {
  shell: MobileShell;
  loaded: boolean;
  setShell: (v: MobileShell) => void;
} {
  const [shell, setShellState] = useState<MobileShell>(SHELL_DEFAULT);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setShellState(readMobileShell());
    setLoaded(true);
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<MobileShell>).detail;
      if (detail === 'v1' || detail === 'classic') setShellState(detail);
    };
    window.addEventListener(SHELL_EVENT, onChange as EventListener);
    return () => window.removeEventListener(SHELL_EVENT, onChange as EventListener);
  }, []);

  const setShell = (v: MobileShell) => {
    writeMobileShell(v);
    setShellState(v);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SHELL_EVENT, { detail: v }));
    }
  };

  return { shell, loaded, setShell };
}
