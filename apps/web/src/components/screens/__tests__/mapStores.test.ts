import { deriveStores, type MapGroup, type ScreenForMap } from '../mapStores';

const ADDR = '3300 E Flamingo Rd, Las Vegas, NV 89121, USA';
const scr = (over: Partial<ScreenForMap>): ScreenForMap => ({
  id: 'x', name: 'Screen', status: 'ONLINE', latitude: 36.11, longitude: -115.12, address: ADDR, geoSource: 'group', ...over,
});
const GROUPS: MapGroup[] = [
  { id: 'lobby', name: 'Lobby', address: ADDR, latitude: 36.11, longitude: -115.12 },
  { id: 'cardio', name: 'Cardio floor', address: ADDR, latitude: 36.11, longitude: -115.12 },   // pinned here, nothing in it yet
  { id: 'annex', name: 'Annex', address: '10 Annex Way, Henderson, NV 89011', latitude: 36.03, longitude: -114.98 }, // its own place, empty
];

describe('deriveStores — Location → Group → Equipment', () => {
  const located = [
    scr({ id: 'a', name: 'Front desk', screenGroupId: 'lobby', screenGroupName: 'Lobby' }),
    scr({ id: 'b', name: 'Lobby wall', screenGroupId: 'lobby', screenGroupName: 'Lobby', status: 'OFFLINE' }),
    scr({ id: 'c', name: 'Loose one', screenGroupId: null }),
  ];

  it('one address = one location; inside it the groups, inside them the equipment', () => {
    const [store] = deriveStores(located, false, GROUPS).filter((s) => s.devices.length > 0);
    expect(store.label).toBe('3300 E Flamingo Rd');
    expect(store.city).toBe('Las Vegas, NV');
    expect(store.devices).toHaveLength(3);
    expect(store.groups.map((g) => `${g.name}:${g.devices.length}`)).toEqual(['Lobby:2', 'Cardio floor:0', 'Not in a group:1']);
  });

  it('a group rolls up its worst device; the location rolls up its worst group', () => {
    const [store] = deriveStores(located, false, GROUPS).filter((s) => s.devices.length > 0);
    expect(store.groups.find((g) => g.id === 'lobby')!.status).toBe('OFFLINE');
    expect(store.groups.find((g) => g.id === 'cardio')!.status).toBeNull();
    expect(store.status).toBe('OFFLINE');
  });

  it('a pinned group with no screens is still a location — "No screens yet", never hidden', () => {
    const stores = deriveStores(located, false, GROUPS);
    const annex = stores.find((s) => s.key.startsWith('10 annex way'));
    expect(annex).toBeDefined();
    expect(annex!.devices).toHaveLength(0);
    expect(annex!.groups).toEqual([{ id: 'annex', name: 'Annex', devices: [], status: null }]);
    expect(annex!.status).toBe('PENDING');
  });

  it('a location with equipment sorts above an empty one, worst first', () => {
    expect(deriveStores(located, false, GROUPS).map((s) => s.label)).toEqual(['3300 E Flamingo Rd', '10 Annex Way']);
  });

  it('without any groups the old behaviour holds: devices grouped by address only', () => {
    const stores = deriveStores([scr({ id: 'a' }), scr({ id: 'b', address: '1 Other St, Reno, NV 89501', latitude: 39.5, longitude: -119.8 })], false);
    expect(stores.map((s) => s.label).sort()).toEqual(['1 Other St', '3300 E Flamingo Rd']);
    const flamingo = stores.find((s) => s.label === '3300 E Flamingo Rd')!;
    expect(flamingo.groups).toEqual([{ id: null, name: 'Not in a group', devices: [expect.objectContaining({ id: 'a' })], status: 'ONLINE' }]);
  });
});

describe('deriveStores — one building stays one location', () => {
  it('a ZIP on the group\'s address but not the screens\' does not split the location', () => {
    const located = [scr({ id: 'a', address: '1 Capitol Ave, Springfield, IL', latitude: 39.7817, longitude: -89.6501, screenGroupId: 'cardio', screenGroupName: 'Cardio floor' })];
    const groups: MapGroup[] = [{ id: 'cardio', name: 'Cardio floor', address: '1 Capitol Ave, Springfield, IL 62701', latitude: 39.7817, longitude: -89.6501 }];
    const stores = deriveStores(located, false, groups);
    expect(stores).toHaveLength(1);
    expect(stores[0].groups.map((g) => `${g.name}:${g.devices.length}`)).toEqual(['Cardio floor:1']);
  });
  it('a group pinned within ~50 m of a location joins it even when the address text differs', () => {
    const located = [scr({ id: 'a', address: '1 Capitol Avenue, Springfield, IL', latitude: 39.7817, longitude: -89.6501 })];
    const groups: MapGroup[] = [{ id: 'g', name: 'Lobby', address: 'Capitol Ave (rear entrance), Springfield IL', latitude: 39.7819, longitude: -89.6503 }];
    const stores = deriveStores(located, false, groups);
    expect(stores).toHaveLength(1);
    expect(stores[0].groups.map((g) => g.name)).toEqual(['Lobby', 'Not in a group']);
  });
});
