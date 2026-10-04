import type { Store } from './mapStores';
import type { LocationPin } from './ScreenMap';

/** A shared address remains one physical pin, with its groups named first. */
export type MoreGroupsLabel = (first: string, more: number) => string;
const englishMoreGroups: MoreGroupsLabel = (first, more) => `${first} + ${more} ${more === 1 ? 'group' : 'groups'}`;

export function storeLocationName(store: Store, moreGroups: MoreGroupsLabel = englishMoreGroups): string {
  const names = [...new Set(store.groups.filter(group => group.id && group.name.trim()).map(group => group.name.trim()))].sort((a, b) => a.localeCompare(b));
  if (!names.length) return store.label;
  return names.length === 1 ? names[0] : moreGroups(names[0], names.length - 1);
}

/** The Screens map uses the same locations as its rail and the active account's brand. */
export function storeLocationPins(stores: Store[], logoUrl: string | null, selectedKey: string | null, moreGroups?: MoreGroupsLabel): LocationPin[] {
  return stores.map(store => {
    const name = storeLocationName(store, moreGroups);
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
