import { otaCheckAnswered } from '../otaAttempt';

test('an already-current answer to the old request survives a web reload without replaying an APK update', () => {
  expect(otaCheckAnswered('UP_TO_DATE', '2026-10-06T20:50:00Z', '2026-10-06T18:13:00Z')).toBe(true);
});

test('a new push is not suppressed by the previous check, and missing or invalid evidence stays pending', () => {
  expect(otaCheckAnswered('UP_TO_DATE', '2026-10-06T20:50:00Z', '2026-10-06T21:15:00Z')).toBe(false);
  for (const state of ['CHECKING', 'DOWNLOADING', 'INSTALLING', 'INSTALLED', 'ERROR', null]) {
    expect(otaCheckAnswered(state, '2026-10-06T20:50:00Z', '2026-10-06T18:13:00Z')).toBe(false);
  }
  expect(otaCheckAnswered('UP_TO_DATE', null, '2026-10-06T18:13:00Z')).toBe(false);
  expect(otaCheckAnswered('UP_TO_DATE', 'invalid', '2026-10-06T18:13:00Z')).toBe(false);
  expect(otaCheckAnswered('UP_TO_DATE', '2026-10-06T20:50:00Z', '')).toBe(false);
});
