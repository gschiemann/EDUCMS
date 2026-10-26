/**
 * Settings — the six areas (Phase 1 simplification, 2026-10-26).
 *
 * The registry is the whole navigation contract: which areas a person sees,
 * which page every old URL opens, and that no URL lost its page.
 */
import {
  SETTINGS_AREAS,
  SETTINGS_JOBS,
  areaHref,
  canSeeSettings,
  routeAllowed,
  routeForPathname,
  sectionForPathname,
  settingsHref,
  visibleAreas,
  visibleJobs,
  visibleSections,
  visibleTabs,
} from '../registry';

const ids = (role: string, vertical?: string) => visibleAreas(role, vertical).map((a) => a.id);

describe('the six areas', () => {
  it('are named after jobs, in this order', () => {
    expect(SETTINGS_AREAS.map((a) => a.id)).toEqual(['organization', 'emergency', 'team', 'connections', 'billing', 'advanced']);
  });

  it('an organization admin sees all six', () => {
    expect(ids('DISTRICT_ADMIN', 'K12')).toEqual(['organization', 'emergency', 'team', 'connections', 'billing', 'advanced']);
    expect(ids('SUPER_ADMIN', 'RESTAURANT')).toHaveLength(6);
  });

  it('a location admin sees all six, without the org-admin pages inside them', () => {
    expect(ids('SCHOOL_ADMIN', 'K12')).toHaveLength(6);
    const org = SETTINGS_AREAS.find((a) => a.id === 'organization')!;
    expect(visibleTabs(org, 'SCHOOL_ADMIN', 'K12').map((t) => t.id)).toEqual(['brand', 'privacy']);
    const team = SETTINGS_AREAS.find((a) => a.id === 'team')!;
    expect(visibleTabs(team, 'SCHOOL_ADMIN', 'K12').map((t) => t.id)).toEqual(['people']);
    const advanced = SETTINGS_AREAS.find((a) => a.id === 'advanced')!;
    expect(visibleTabs(advanced, 'SCHOOL_ADMIN').map((t) => t.id)).toEqual(['support']);
  });

  it('Editors and Viewers see no Settings at all (owner decision 1)', () => {
    expect(canSeeSettings('CONTRIBUTOR')).toBe(false);
    expect(canSeeSettings('RESTRICTED_VIEWER')).toBe(false);
    expect(ids('CONTRIBUTOR', 'K12')).toEqual([]);
    expect(ids('RESTRICTED_VIEWER', 'K12')).toEqual([]);
    expect(visibleSections('CONTRIBUTOR', 'K12')).toEqual([]);
  });

  it('student privacy is for schools and sports venues; Clever for K-12 org admins', () => {
    const org = SETTINGS_AREAS.find((a) => a.id === 'organization')!;
    const conn = SETTINGS_AREAS.find((a) => a.id === 'connections')!;
    expect(visibleTabs(org, 'DISTRICT_ADMIN', 'K12').map((t) => t.id)).toContain('privacy');
    expect(visibleTabs(org, 'DISTRICT_ADMIN', 'SPORTS').map((t) => t.id)).toContain('privacy');
    expect(visibleTabs(org, 'DISTRICT_ADMIN', 'RESTAURANT').map((t) => t.id)).not.toContain('privacy');
    expect(visibleTabs(conn, 'DISTRICT_ADMIN', 'K12').map((t) => t.id)).toContain('rosters');
    expect(visibleTabs(conn, 'DISTRICT_ADMIN', 'GYM').map((t) => t.id)).not.toContain('rosters');
    expect(visibleTabs(conn, 'SCHOOL_ADMIN', 'K12').map((t) => t.id)).not.toContain('rosters');
  });

  it('screen updates are no longer a customer setting (owner decision 3)', () => {
    for (const role of ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']) {
      expect(visibleSections(role, 'K12').map((s) => s.id)).not.toContain('player');
    }
  });
});

describe('every old URL still opens its page', () => {
  const cases: Array<[string, string, string]> = [
    ['/s/settings/organization', 'organization', 'profile'],
    ['/s/settings/branding', 'organization', 'brand'],
    ['/s/settings/locations', 'organization', 'locations'],
    ['/s/settings/sports', 'organization', 'privacy'],
    ['/s/settings/emergency', 'emergency', 'emergency'],
    ['/s/settings/people', 'team', 'people'],
    ['/s/settings/people/sso', 'team', 'sso'],
    ['/s/settings/sso', 'team', 'sso'],
    ['/s/settings/integrations', 'connections', 'connections'],
    ['/s/settings/ai', 'connections', 'ai'],
    ['/s/settings/integrations/ai', 'connections', 'ai'],
    ['/s/settings/pos', 'connections', 'pos'],
    ['/s/settings/integrations/pos', 'connections', 'pos'],
    ['/s/settings/streaming', 'connections', 'video'],
    ['/s/settings/integrations/streaming', 'connections', 'video'],
    ['/s/settings/integrations/clever', 'connections', 'rosters'],
    ['/s/settings/monetize', 'connections', 'connections'],
    ['/s/settings/billing', 'billing', 'billing'],
    ['/s/settings/developer', 'advanced', 'developer'],
    ['/s/settings/support-access', 'advanced', 'support'],
  ];
  it.each(cases)('%s → %s / %s', (path, area, tab) => {
    const r = routeForPathname(path);
    expect(r?.area.id).toBe(area);
    expect(r?.tab.id).toBe(tab);
  });

  it('query strings and anchors do not change the answer (Stripe / OAuth returns)', () => {
    expect(routeForPathname('/s/settings/billing?checkout=success')?.tab.id).toBe('billing');
    expect(routeForPathname('/s/settings/pos?connected=square')?.tab.id).toBe('pos');
  });

  it('the longest path wins: people/sso is Single sign-on, not People', () => {
    expect(routeForPathname('/s/settings/people/sso')?.tab.id).toBe('sso');
    expect(routeForPathname('/s/settings/people')?.tab.id).toBe('people');
  });

  it('the home and the hidden routes are not area pages', () => {
    expect(routeForPathname('/s/settings')).toBeNull();
    expect(routeForPathname('/s/settings/')).toBeNull();
    expect(routeForPathname('/s/settings/player')).toBeNull();
    expect(sectionForPathname('/s/settings/player')).toBe('player');
    expect(sectionForPathname('/s/settings/usb')).toBe('player');
    expect(sectionForPathname('/s/settings/security')).toBe('security');
  });

  it('who may open a route: role only — a vertical hides a tab, never the URL', () => {
    expect(routeAllowed('/s/settings/locations', 'SCHOOL_ADMIN')).toBe(false);
    expect(routeAllowed('/s/settings/locations', 'DISTRICT_ADMIN')).toBe(true);
    expect(routeAllowed('/s/settings/sports', 'SCHOOL_ADMIN')).toBe(true);
    expect(routeAllowed('/s/settings/branding', 'CONTRIBUTOR')).toBe(false);
    expect(routeAllowed('/s/settings/emergency', 'RESTRICTED_VIEWER')).toBe(false);
    // The screen-updates note answers every role itself.
    expect(routeAllowed('/s/settings/player', 'CONTRIBUTOR')).toBe(true);
  });
});

describe('links', () => {
  it('an area opens on the first page this person can see', () => {
    const org = SETTINGS_AREAS.find((a) => a.id === 'organization')!;
    // Logo & colors is the day-1 job, so Organization opens there for everyone.
    expect(areaHref('s', org, 'DISTRICT_ADMIN', 'K12')).toBe('/s/settings/branding');
    expect(areaHref('s', org, 'SCHOOL_ADMIN', 'K12')).toBe('/s/settings/branding');
  });

  it('settingsHref keeps the page ids callers already use', () => {
    expect(settingsHref('s', 'organization')).toBe('/s/settings/organization');
    expect(settingsHref('s', 'brand')).toBe('/s/settings/branding');
    expect(settingsHref('s', 'integrations')).toBe('/s/settings/integrations');
    expect(settingsHref('s', 'supportAccess')).toBe('/s/settings/support-access');
  });
});

describe('search jobs', () => {
  it('every job has a unique id and a real destination', () => {
    const seen = new Set<string>();
    for (const job of SETTINGS_JOBS) {
      expect(seen.has(job.id)).toBe(false);
      seen.add(job.id);
      expect(job.href).not.toMatch(/^\//);
    }
  });

  it('a person only finds what they can open', () => {
    const editorJobs = visibleJobs('CONTRIBUTOR', 'K12').map((j) => j.id);
    expect(editorJobs).toEqual(['myPassword', 'myPasskey', 'myLanguage']);
    expect(visibleJobs('SCHOOL_ADMIN', 'K12').map((j) => j.id)).not.toContain('apiKeys');
    expect(visibleJobs('DISTRICT_ADMIN', 'GYM').map((j) => j.id)).not.toContain('clever');
  });
});
