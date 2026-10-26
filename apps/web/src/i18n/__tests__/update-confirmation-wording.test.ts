import en from '../messages/en.json';
import es from '../messages/es.json';
import zh from '../messages/zh.json';

/**
 * 2026-10-26 (owner, on site updating screens): "why do we say update needs a tap
 * when most aren't touch screens". Most panels are wall-mounted and run by a D-pad
 * remote, so every line about an update that waits for a person to confirm it
 * (state NEEDS_TAP) names the action AND the place, remote first:
 *   "At the screen: press Back, choose Install, then select Install in Android's
 *    dialog (OK on the remote, or tap it)."
 * in all three languages. The keys keep their names (`needsTap`, `countTap`,
 * `statusTap`, …); only the words changed. The Jest next-intl stand-in reads
 * en.json only, so nothing else would notice Spanish or Chinese sliding back.
 */
const ACTION_KEYS = [
  'settings.cc.player.autoReady.description',
  'screens.apk.sublineNeedsTap',
  'screens.apk.push.sublineNeedsTapLikely',
  'screens.autoUpdate.needsTap',
  'screens.bulk.installPrompt',
];
const STATUS_KEYS = [
  'settings.cc.player.autoReady.countTap',
  'settings.cc.player.autoReady.statusTap',
  'screens.apk.needsTap',
  'screens.autoUpdate.reasonInstalledByAnotherApp',
  'screens.interruptions.kindOtaNeedsTap',
  'fieldBuilds.screens.state.needs-tap',
];

const catalogs: Record<string, unknown> = { en, es, zh };
const read = (lang: string, path: string): string => {
  const v = path.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    catalogs[lang],
  );
  if (typeof v !== 'string') throw new Error(`${lang}: ${path} is not a string`);
  return v;
};

/** A touch-only instruction, per language (the remote-or-touch parenthetical is stripped first). */
const BARE_TOUCH: Record<string, RegExp> = {
  en: /\btap(s|ped|ping)?\b/i,
  es: /\btoque\b|\btoc(a|as|ar|an|ando|ándolo)\b|\btócalo\b/i,
  zh: /点按|点击|轻触/,
};
/** The remote, named. */
const REMOTE: Record<string, RegExp> = { en: /OK on the remote/, es: /control remoto/, zh: /遥控器/ };
const REMOTE_HINT = /\([^)]*(?:remote|control remoto)[^)]*\)|（[^）]*遥控器[^）]*）/g;

describe.each(['en', 'es', 'zh'])('%s: an update waiting for a person is worded remote-first', (lang) => {
  it.each([...ACTION_KEYS, ...STATUS_KEYS])('%s never tells anyone to tap on its own', (path) => {
    const rest = read(lang, path).replace(REMOTE_HINT, '');
    expect(rest).not.toMatch(BARE_TOUCH[lang]);
  });

  it.each(ACTION_KEYS)('%s gives the remote first, then touch', (path) => {
    expect(read(lang, path)).toMatch(REMOTE[lang]);
  });
});

it('the two update lines say where to press, in order: Back, then Install, then Android\'s dialog', () => {
  for (const path of ['screens.apk.sublineNeedsTap', 'screens.apk.push.sublineNeedsTapLikely']) {
    expect(read('en', path)).toMatch(/At the screen: press Back, choose Install, then select Install in Android.s dialog/);
    expect(read('es', path)).toMatch(/En la pantalla: pulsa Atrás, elige «Install» y luego selecciona Instalar en el diálogo de Android/);
    expect(read('zh', path)).toMatch(/在屏幕前操作：按“返回”键，选择“Install”，然后在 Android 对话框中选择“安装”/);
  }
});

it('the short status is "waiting for someone at the screen", never "needs a tap"', () => {
  expect(read('en', 'screens.apk.needsTap')).toBe('Waiting for someone at the screen');
  expect(read('en', 'fieldBuilds.screens.state.needs-tap')).toBe('Waiting for someone at the screen');
  expect(read('en', 'screens.interruptions.kindOtaNeedsTap')).toBe('Player update waiting for someone at the screen');
});
