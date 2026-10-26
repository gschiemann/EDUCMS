/**
 * /signup used to print the API's English sentences to every reader. These
 * pin the mapping to translated messages, and read the API source so a
 * reworded server message fails here instead of quietly falling back to
 * English for Spanish and Chinese visitors.
 */
import fs from 'fs';
import path from 'path';
import en from '../../../i18n/messages/en.json';
import es from '../../../i18n/messages/es.json';
import zh from '../../../i18n/messages/zh.json';
import { SIGNUP_SERVER_MESSAGES, signupErrorFor } from '../signup-errors';

const ONBOARDING_SERVICE = fs.readFileSync(
  path.resolve(__dirname, '../../../../../api/src/onboarding/onboarding.service.ts'),
  'utf8',
);

describe('signupErrorFor', () => {
  it('maps every sentence the signup service throws', () => {
    expect(signupErrorFor(409, { message: 'That slug is already taken.' })).toEqual({ key: 'slugTaken' });
    expect(signupErrorFor(409, { message: 'An account with that email already exists.' })).toEqual({ key: 'emailTaken' });
    expect(signupErrorFor(400, { message: 'Organization name is required.' })).toEqual({ key: 'nameRequired' });
    expect(signupErrorFor(400, { message: 'Slug is required.' })).toEqual({ key: 'slugRequired' });
    expect(signupErrorFor(400, { message: 'A valid admin email is required.' })).toEqual({ key: 'emailInvalid' });
    expect(signupErrorFor(400, { message: 'Invalid vertical.' })).toEqual({ key: 'industry' });
  });

  it('reads the validation pipe’s issues by field', () => {
    const body = { message: 'Please check adminEmail: Invalid email', issues: [{ path: 'adminEmail', message: 'Invalid email' }] };
    expect(signupErrorFor(400, body)).toEqual({ key: 'emailInvalid' });
    expect(signupErrorFor(400, { message: 'x', issues: [{ path: 'phone' }] })).toEqual({ key: 'checkFields' });
  });

  it('says "too many attempts" for the throttle and "try again" for a server failure', () => {
    expect(signupErrorFor(429, { message: 'ThrottlerException: Too Many Requests' })).toEqual({ key: 'tooMany' });
    expect(signupErrorFor(500, { message: 'Internal server error' })).toEqual({ key: 'generic' });
    expect(signupErrorFor(502, null)).toEqual({ key: 'generic' });
    expect(signupErrorFor(400, {})).toEqual({ key: 'generic' });
  });

  it('falls back to the server’s own words for an answer it does not know', () => {
    expect(signupErrorFor(403, { message: 'Signups are paused.' })).toEqual({ raw: 'Signups are paused.' });
  });

  it('stays in step with the API: every mapped sentence is still thrown by OnboardingService.signup', () => {
    for (const sentence of Object.keys(SIGNUP_SERVER_MESSAGES)) {
      expect(ONBOARDING_SERVICE).toContain(`'${sentence}'`);
    }
  });

  it('has a translated message for every key, in every language', () => {
    const keys = [...new Set(Object.values(SIGNUP_SERVER_MESSAGES)), 'checkFields', 'tooMany', 'generic', 'passwordLength', 'passwordMismatch', 'unreachable'];
    for (const cat of [en, es, zh] as Array<{ signup: { errors: Record<string, string> } }>) {
      for (const k of keys) expect(cat.signup.errors[k]).toEqual(expect.any(String));
    }
    for (const k of keys) {
      expect(es.signup.errors[k as keyof typeof es.signup.errors]).not.toBe(en.signup.errors[k as keyof typeof en.signup.errors]);
      expect(zh.signup.errors[k as keyof typeof zh.signup.errors]).not.toBe(en.signup.errors[k as keyof typeof en.signup.errors]);
    }
  });

  it('has picker, label, example and hero copy for every vertical, in every language', () => {
    const verticals = Object.keys(en.signup.verticals);
    expect(verticals.length).toBeGreaterThanOrEqual(12);
    for (const cat of [en, es, zh] as Array<{ signup: { verticals: Record<string, Record<string, string>> } }>) {
      for (const v of verticals) {
        for (const f of ['picker', 'nameLabel', 'namePlaceholder', 'where']) {
          expect(cat.signup.verticals[v][f]).toEqual(expect.any(String));
        }
      }
    }
  });
});
