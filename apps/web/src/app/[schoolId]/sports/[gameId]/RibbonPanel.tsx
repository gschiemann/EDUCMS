'use client';

/**
 * VenueOS Sports — custom ribbon messages.
 *
 * The operator types message lines that scroll on the stadium ribbon
 * in place of the default crowd prompts ("LET'S GO!", etc.). One line
 * per message; an empty box clears back to the auto prompts. Saved
 * through the ribbon control endpoint and surfaced on /ribbon/:id
 * within ~1s — the ribbon polls the same feed every 750ms.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGame, useGameControl } from '@/hooks/use-api';

export function RibbonPanel({ gameId }: { gameId: string }) {
  const { data: game } = useGame(gameId);
  const ctl = useGameControl(gameId);

  const [text, setText] = useState('');
  const seeded = useRef(false);
  // Seed the textarea once, from the game's saved ribbon messages —
  // don't re-seed on later polls or it would yank an in-progress edit.
  useEffect(() => {
    if (!seeded.current && game) {
      seeded.current = true;
      const msgs = (game as { ribbonMessages?: string[] }).ribbonMessages || [];
      setText(msgs.join('\n'));
    }
  }, [game]);

  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = async () => {
    const messages = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 30);
    await ctl.ribbon.mutateAsync({ messages });
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2400);
  };

  const lineCount = text.split('\n').map((l) => l.trim()).filter(Boolean).length;

  return (
    <div>
      <p className="text-xs text-slate-400 mb-2">
        Custom messages for the stadium ribbon — one per line. They scroll between the
        score, roster, and sponsors. Leave this empty to use the default crowd prompts.
      </p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setSaved(false); }}
        rows={5}
        maxLength={4000}
        placeholder={'Welcome to Friday Night Lights\nConcessions open until halftime\nGO LIONS!'}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
        style={{ resize: 'vertical' }}
      />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={save} disabled={ctl.ribbon.isPending} className="gap-1.5">
          {ctl.ribbon.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saved ? 'Saved' : 'Save ribbon messages'}
        </Button>
        <span className="text-xs text-slate-400">
          {lineCount === 0
            ? 'Using the default crowd prompts'
            : `${lineCount} message${lineCount === 1 ? '' : 's'} · max 30`}
        </span>
      </div>
    </div>
  );
}
