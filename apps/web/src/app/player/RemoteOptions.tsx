'use client';

import { useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { isRemoteOkKey, remoteMoveForKey } from './remoteConfirm';

/** Remote navigation for the existing pre-content recovery menu. Back remains
 * owned by the page, exactly as it is for RemoteDialog. No OEM spatial-nav
 * dependency, and no keys or DOM focus can reach the pairing card underneath. */
export function RemoteOptions({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const panel = root.current;
    if (!panel) return;
    const buttons = () => Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
      .filter((button) => !button.hidden && button.getAttribute('aria-hidden') !== 'true');
    let parked: HTMLButtonElement | undefined;
    let activation: HTMLButtonElement | undefined;
    const park = (button: HTMLButtonElement | undefined) => {
      parked?.removeAttribute('data-remote-focused');
      parked = button;
      button?.setAttribute('data-remote-focused', 'true');
      button?.focus();
    };
    park(buttons()[0]);
    const focus = (event: FocusEvent) => {
      const available = buttons();
      if (available.includes(event.target as HTMLButtonElement)) {
        if (event.target !== parked) park(event.target as HTMLButtonElement);
      } else {
        park(available.includes(parked!) ? parked : available[0]);
      }
    };
    const down = (event: KeyboardEvent) => {
      const move = remoteMoveForKey(event.key);
      if (!move && event.key !== 'Tab' && !isRemoteOkKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const available = buttons();
      if (!available.length) return;
      const index = available.indexOf(parked!);
      if (move || event.key === 'Tab') {
        activation = undefined;
        const step = move === 'prev' || (event.key === 'Tab' && event.shiftKey) ? -1 : 1;
        park(available[(Math.max(index, 0) + step + available.length) % available.length]);
      } else {
        // Activate on release: neither a held OK nor its keyup may fall
        // through to the pairing card if the chosen action closes us.
        activation = event.repeat ? undefined : available[index < 0 ? 0 : index];
      }
    };
    const up = (event: KeyboardEvent) => {
      if (!isRemoteOkKey(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const chosen = activation;
      activation = undefined;
      if (chosen && buttons().includes(chosen)) chosen.click();
    };
    window.addEventListener('focusin', focus, true);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('focusin', focus, true);
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);
  return (
    <div {...props} ref={root} role="dialog" aria-modal="true" data-edu-remote-options="">
      <style>{'[data-edu-remote-options] button[data-remote-focused="true"] { outline: 4px solid #fde047 !important; outline-offset: 4px; }'}</style>
      {children}
    </div>
  );
}
