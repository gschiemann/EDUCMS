/**
 * The stop / pause / cancel-publish copy never says "on 0 screens"
 * (2026-10-10). A rule that reaches no screen yet (an empty group, a later
 * start, a copy still preparing) has no "on N screens" to state: every such
 * message carries an empty `=0` branch, in every language. The schedule
 * card's power-button tooltip was the last one still built in English with a
 * bare count ("Pause this schedule on 0 screens").
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';

const KEYS: Array<[string, string]> = [
  ['stopCancelPublishMessage', 'screens'],
  ['windowCancelMessage', 'count'],
  ['pauseScheduleOn', 'count'],
  ['resumeScheduleOn', 'count'],
];

describe('pause / cancel-publish copy at zero screens', () => {
  for (const [lang, catalog] of Object.entries({ en, es, zh })) {
    const page = (catalog as unknown as { playlistsPage: Record<string, string> }).playlistsPage;
    it.each(KEYS)(`${lang}: %s drops the screen count at zero`, (key, arg) => {
      const msg = page[key];
      expect(msg).toEqual(expect.any(String));
      expect(msg).toMatch(new RegExp(`\\{${arg},\\s*plural,\\s*=0 \\{\\}`));
    });
  }

  it('the schedule card tooltip reads the catalog, not an English template', () => {
    const src = readFileSync(resolve(__dirname, '../ClassicPlaylistsPage.tsx'), 'utf8');
    expect(src).not.toMatch(/this schedule on \$\{/);
    expect(src).toContain("'playlistsPage.pauseScheduleOn'");
    expect(src).toContain("'playlistsPage.resumeScheduleOn'");
  });
});
