import {
  adoptUsbPackage,
  applyUsbOverlay,
  parseImportedAt,
  parseUsbPackage,
  readUsbMemo,
  serverPlaylistSig,
  usbOnlyManifest,
  usbOverlayActive,
  writeUsbMemo,
  type UsbOverlayState,
} from '../usbPackage';

const pkgJson = {
  schema: 'edu-cms-usb-bundle/v1',
  bundleVersion: '1000',
  tenantId: 't1',
  bundleLabel: 'Lobby',
  playlists: [{ id: 'usb-pl', name: 'Lobby', items: [{ url: 'https://cdn/a.png', duration_ms: 8000 }], schedule: { mode: 'replace' } }],
};
const server = (ids: string[], extra: Record<string, unknown> = {}) => ({
  tenantId: 't1', isEmergency: false, playlists: ids.map((id) => ({ id, items: [] })), ...extra,
});
const empty: UsbOverlayState = { pkg: null, memo: null, lastLiveSig: null };

describe('parseUsbPackage', () => {
  it('accepts the APK-served manifest', () => {
    expect(parseUsbPackage(pkgJson)).toMatchObject({ bundleVersion: '1000', tenantId: 't1', label: 'Lobby' });
  });
  it('refuses anything else', () => {
    expect(parseUsbPackage(null)).toBeNull();
    expect(parseUsbPackage({ ...pkgJson, schema: 'x' })).toBeNull();
    expect(parseUsbPackage({ ...pkgJson, tenantId: '' })).toBeNull();
    expect(parseUsbPackage({ ...pkgJson, playlists: [] })).toBeNull();
    expect(parseUsbPackage({ ...pkgJson, playlists: [{ name: 'no id' }] })).toBeNull();
  });
});

describe('applyUsbOverlay', () => {
  const pkg = parseUsbPackage(pkgJson)!;

  it('plays the USB playlists in place of the server ones, dropping server-driven native/sync fields', () => {
    let s = adoptUsbPackage({ ...empty, lastLiveSig: 'a' }, pkg);
    const r = applyUsbOverlay(server(['a'], { nativeVideo: { x: 1 }, sync: { on: true }, canvasW: 960 }), s, false);
    const m = r.manifest as any;
    expect(m.playlists).toEqual(pkg.playlists);
    expect(m.nativeVideo).toBeUndefined();
    expect(m.sync).toBeUndefined();
    expect(m.canvasW).toBe(960); // screen settings stay
    s = r.state;
    expect(usbOverlayActive(s)).toBe(true);
  });

  it('EMERGENCY FIRST: an emergency manifest is passed through untouched and the stick survives it', () => {
    const s = adoptUsbPackage({ ...empty, lastLiveSig: 'a' }, pkg);
    const em = { isEmergency: true, emergencyType: 'LOCKDOWN', playlists: [{ id: 'em', items: [] }] };
    const r = applyUsbOverlay(em, s, false);
    expect(r.manifest).toBe(em);
    expect(r.state).toBe(s);
    // After the all-clear the same server content comes back → stick plays again.
    expect((applyUsbOverlay(server(['a']), r.state, false).manifest as any).playlists).toEqual(pkg.playlists);
  });

  it('keeps playing while the server names the same playlists, retires on a new publish, and stays retired', () => {
    let s = adoptUsbPackage({ ...empty, lastLiveSig: 'a' }, pkg);
    s = applyUsbOverlay(server(['a']), s, false).state;
    expect(usbOverlayActive(s)).toBe(true);
    const r = applyUsbOverlay(server(['a', 'b']), s, false);
    expect((r.manifest as any).playlists.map((p: any) => p.id)).toEqual(['a', 'b']);
    expect(usbOverlayActive(r.state)).toBe(false);
    // Re-reading the SAME package (stick still in, reboot) does not revive it…
    const again = adoptUsbPackage(r.state, pkg);
    expect(usbOverlayActive(again)).toBe(false);
    // …a NEW package does.
    const fresh = adoptUsbPackage(again, { ...pkg, bundleVersion: '2000' });
    expect(usbOverlayActive(fresh)).toBe(true);
    expect(fresh.memo?.baseSig).toBe('a,b');
  });

  it('a person bringing the SAME package in again (a new import time) plays it again over a newer publish', () => {
    const first = { ...pkg, importedAt: 1_000 };
    let s = adoptUsbPackage({ ...empty, lastLiveSig: 'a' }, first);
    expect(s.memo?.importedAt).toBe(1_000);
    s = applyUsbOverlay(server(['a', 'b']), s, false).state; // the server published → retired
    expect(usbOverlayActive(s)).toBe(false);
    // The stick left in (reboot / the minute scan): same import time — stays retired.
    s = adoptUsbPackage(s, { ...pkg, importedAt: 1_000 });
    expect(usbOverlayActive(s)).toBe(false);
    // Re-inserted, or "Import from USB": the APK stamped a new import time.
    s = adoptUsbPackage(s, { ...pkg, importedAt: 2_000 });
    expect(usbOverlayActive(s)).toBe(true);
    expect(s.memo).toEqual({ bundleVersion: '1000', baseSig: 'a,b', retired: false, importedAt: 2_000 });
    // …and it now beats that publish until the NEXT one.
    expect((applyUsbOverlay(server(['a', 'b']), s, false).manifest as any).playlists).toEqual(pkg.playlists);
    expect(usbOverlayActive(applyUsbOverlay(server(['c']), s, false).state)).toBe(false);
  });

  it('a memo from before import times adopts the first one without reviving anything', () => {
    const legacy: UsbOverlayState = { pkg: null, memo: { bundleVersion: '1000', baseSig: 'a', retired: true }, lastLiveSig: 'a,b' };
    const s = adoptUsbPackage(legacy, { ...pkg, importedAt: 5_000 });
    expect(usbOverlayActive(s)).toBe(false);
    expect(s.memo).toEqual({ bundleVersion: '1000', baseSig: 'a', retired: true, importedAt: 5_000 });
    // An APK that sends no import time changes nothing either.
    expect(adoptUsbPackage(legacy, { ...pkg, importedAt: null }).memo).toBe(legacy.memo);
    // The next real re-import is recognised.
    expect(usbOverlayActive(adoptUsbPackage(s, { ...pkg, importedAt: 6_000 }))).toBe(true);
  });

  it('imported while offline: the first live manifest becomes the baseline, not a retirement', () => {
    let s = adoptUsbPackage(empty, pkg);
    expect(s.memo?.baseSig).toBeNull();
    s = applyUsbOverlay(server(['old']), s, false).state;
    expect(usbOverlayActive(s)).toBe(true);
    expect(s.memo?.baseSig).toBe('old');
  });

  it('a cached (offline) manifest shows the stick but never moves the baseline', () => {
    const s = adoptUsbPackage({ ...empty, lastLiveSig: 'a' }, pkg);
    const r = applyUsbOverlay(server(['zzz']), s, true);
    expect((r.manifest as any).playlists).toEqual(pkg.playlists);
    expect(r.state.memo).toEqual(s.memo);
  });

  it('ignores a package from another organization', () => {
    const s = adoptUsbPackage({ ...empty, lastLiveSig: 'a' }, pkg);
    const m = { ...server(['a']), tenantId: 'other' };
    expect(applyUsbOverlay(m, s, false).manifest).toBe(m);
  });

  it('no package → the manifest is untouched', () => {
    const m = server(['a']);
    expect(applyUsbOverlay(m, empty, false).manifest).toBe(m);
  });
});

describe('page wiring (source guard)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('path') as typeof import('path');
  const PAGE = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');
  const apply = PAGE.slice(PAGE.indexOf('const applyManifest = (manifest: any, fromCache = false) => {'));

  it('the overlay runs inside a try, before the emergency decision', () => {
    const overlay = apply.indexOf('applyUsbOverlay(serverManifest');
    expect(overlay).toBeGreaterThan(0);
    expect(overlay).toBeLessThan(apply.indexOf('signalDisplayEmergencyHold(holdNow, holdNow)'));
    expect(apply.slice(0, overlay)).toMatch(/try \{\s*const usb = $/);
  });

  it('the playable snapshot caches what the SERVER sent, never the stick', () => {
    expect(PAGE).not.toMatch(/cacheManifest\(manifest, screenId, true\)/);
    expect((PAGE.match(/cacheManifest\(serverManifest, screenId, true\)/g) || []).length).toBe(3);
  });

  it('only a page inside the APK asks for the package', () => {
    const loader = PAGE.slice(PAGE.indexOf('const loadUsbPackage = useCallback('));
    expect(loader.indexOf('if (!hasNativeBridge()) return;')).toBeLessThan(loader.indexOf('fetch(USB_PACKAGE_PATH'));
  });

  it('the loader reads the import time and re-applies when a person brought the stick in again', () => {
    const loader = PAGE.slice(PAGE.indexOf('const loadUsbPackage = useCallback('), PAGE.indexOf('const loadUsbPackage = useCallback(') + 2000);
    expect(loader).toContain('parseImportedAt(res.headers.get(USB_IMPORTED_AT_HEADER))');
    expect(loader).toMatch(/prev\.pkg\?\.bundleVersion !== pkg\.bundleVersion \|\| broughtInAgain/);
  });
});

describe('helpers', () => {
  it('serverPlaylistSig is order-independent', () => {
    expect(serverPlaylistSig(server(['b', 'a']))).toBe('a,b');
    expect(serverPlaylistSig({})).toBe('');
  });
  it('usbOnlyManifest is a normal, non-emergency manifest', () => {
    const m = usbOnlyManifest(parseUsbPackage(pkgJson)!, 'scr');
    expect(m).toMatchObject({ screenId: 'scr', tenantId: 't1', isEmergency: false });
  });
  it('the memo round-trips and survives a broken store', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    writeUsbMemo(ls, { bundleVersion: '1', baseSig: 'a', retired: true });
    expect(readUsbMemo(ls)).toEqual({ bundleVersion: '1', baseSig: 'a', retired: true });
    writeUsbMemo(ls, null);
    expect(readUsbMemo(ls)).toBeNull();
    expect(readUsbMemo({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
    writeUsbMemo(ls, { bundleVersion: '2', baseSig: null, retired: false, importedAt: 42 });
    expect(readUsbMemo(ls)).toEqual({ bundleVersion: '2', baseSig: null, retired: false, importedAt: 42 });
  });
  it('the import-time header is a positive epoch-ms or nothing', () => {
    expect(parseImportedAt('1761495599000')).toBe(1761495599000);
    expect(parseImportedAt(' 12 ')).toBe(12);
    expect(parseImportedAt(null)).toBeNull();
    expect(parseImportedAt('')).toBeNull();
    expect(parseImportedAt('0')).toBeNull();
    expect(parseImportedAt('-5')).toBeNull();
    expect(parseImportedAt('soon')).toBeNull();
    expect(parseUsbPackage(pkgJson, 77)?.importedAt).toBe(77);
    expect(parseUsbPackage(pkgJson)?.importedAt).toBeNull();
  });
});
