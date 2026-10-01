import type { Store } from './mapStores';
import type { LocationPin } from './ScreenMap';

/** The Screens map uses the same locations as its rail and the active account's brand. */
export function storeLocationPins(stores: Store[], logoUrl: string | null, selectedKey: string | null): LocationPin[] {
  return stores.map(store => {
    const name = store.groups.length === 1 && store.groups[0].id
      ? store.groups[0].name : store.label;
    const words = name.trim().split(/\s+/).filter(Boolean);
    return {
      id: store.key, name, lat: store.lat, lng: store.lng,
      tone: store.status === 'ONLINE' ? 'ok' : store.status === 'EMERGENCY' ? 'bad' : 'warn',
      logoUrl,
      initials: words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'L',
      selected: selectedKey === store.key,
    };
  });
}
