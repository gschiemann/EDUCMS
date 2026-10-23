import {
  adoptUsbPackage,
  applyUsbOverlay,
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
  });
});
