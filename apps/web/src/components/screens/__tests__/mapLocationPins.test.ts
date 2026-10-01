import { deriveStores, type ScreenForMap } from '../mapStores';
import { storeLocationPins } from '../mapLocationPins';

const group = { id: 'g1', name: 'Tesoro Neighborhood', address: '3193 Red Feather Wy, Roseville, CA', latitude: 38.7, longitude: -121.3 };
const devices: ScreenForMap[] = ['G43', 'G55', 'G65'].map((name, i) => ({
  id: `s${i}`, name, status: 'ONLINE', address: group.address,
  latitude: group.latitude, longitude: group.longitude, screenGroupId: group.id,
}));

describe('physical location logo pins', () => {
  it('three screens at one group address share one named logo pin that opens that location', () => {
    const stores = deriveStores(devices, false, [group]);
    const pins = storeLocationPins(stores, 'https://cdn.example/brookfield.png', stores[0].key);
    expect(pins).toEqual([expect.objectContaining({
      id: stores[0].key, name: group.name, logoUrl: 'https://cdn.example/brookfield.png',
      lat: group.latitude, lng: group.longitude, selected: true, initials: 'TN', tone: 'ok',
    })]);
  });

  it('pinned groups with no screens get a visible location too', () => {
    const pins = storeLocationPins(deriveStores([], false, [group]), null, null);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ name: group.name, logoUrl: null, initials: 'TN', tone: 'warn' });
  });

  it('retains the map classification when a screen is offline or an alert is active', () => {
    const offline = deriveStores([{ ...devices[0], status: 'OFFLINE' }, devices[1]], false, [group]);
    expect(storeLocationPins(offline, null, null)[0].tone).toBe('warn');
    const alert = deriveStores(devices, true, [group]);
    expect(storeLocationPins(alert, null, null)[0].tone).toBe('bad');
  });
});
