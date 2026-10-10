import { DEFAULT_SUPABASE_HOST, supabaseOrigin } from './supabase-origin';

describe('supabaseOrigin', () => {
  it('falls back to the production host only when SUPABASE_URL is unset or blank', () => {
    for (const env of [{}, { SUPABASE_URL: '' }, { SUPABASE_URL: '   ' }]) {
      expect(supabaseOrigin(env)).toEqual({
        origin: `https://${DEFAULT_SUPABASE_HOST}`,
        host: DEFAULT_SUPABASE_HOST,
        fromEnv: false,
      });
    }
  });

  it('derives the exact host from a bare https origin (trailing slash, case, :443 tolerated)', () => {
    for (const v of ['https://abc.supabase.co', 'https://abc.supabase.co/', 'https://ABC.supabase.co', 'https://abc.supabase.co:443']) {
      expect(supabaseOrigin({ SUPABASE_URL: v })).toEqual({ origin: 'https://abc.supabase.co', host: 'abc.supabase.co', fromEnv: true });
    }
  });

  it('refuses anything that is not a bare https origin — and never falls back', () => {
    for (const v of [
      'http://abc.supabase.co',
      'https://u:p@abc.supabase.co',
      'https://abc.supabase.co:8443',
      'https://abc.supabase.co/rest',
      'https://abc.supabase.co/?a=1',
      'https://abc.supabase.co/#x',
      'abc.supabase.co',
      'not a url',
    ]) {
      expect(supabaseOrigin({ SUPABASE_URL: v })).toBeNull();
    }
  });
});
