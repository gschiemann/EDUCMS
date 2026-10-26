import {
  groupScreenListSends,
  isScreenListRow,
  screenListMessageIds,
  sendRootIdOf,
  type ScreenFact,
  type ScreenListRow,
} from './message-targets';

const UUID = '0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_UUID = '11111111-2222-4333-8444-555555555555';
const ROOT = `bcast_${UUID}`;

describe('sendRootIdOf', () => {
  it('recovers the root from the bare id and from any copy of it', () => {
    expect(sendRootIdOf(ROOT)).toBe(ROOT);
    expect(sendRootIdOf(`${ROOT}_screen-b`)).toBe(ROOT);
    expect(sendRootIdOf(`${ROOT}_tenant_with_underscores`)).toBe(ROOT);
  });

  it('is null for every other kind of id', () => {
    expect(sendRootIdOf(`sos_${UUID}`)).toBeNull();
    expect(sendRootIdOf(`media_${UUID}`)).toBeNull();
    expect(sendRootIdOf('bcast_not-a-uuid')).toBeNull();
    expect(sendRootIdOf(`prefix_${ROOT}`)).toBeNull();
    expect(sendRootIdOf('')).toBeNull();
    expect(sendRootIdOf(undefined)).toBeNull();
  });

  it('two different sends never share a root (a UUID has a fixed length)', () => {
    expect(sendRootIdOf(`bcast_${OTHER_UUID}_x`)).not.toBe(ROOT);
    expect(`bcast_${OTHER_UUID}`.startsWith(ROOT)).toBe(false);
  });
});

describe('screenListMessageIds', () => {
  it('gives the FIRST pane (sorted by screen id) the bare id, so the id the API returns is a real row', () => {
    const ids = screenListMessageIds(ROOT, ['scr-b', 'scr-a', 'scr-c']);
    expect(ids.get('scr-a')).toBe(ROOT);
    expect(ids.get('scr-b')).toBe(`${ROOT}_scr-b`);
    expect(ids.get('scr-c')).toBe(`${ROOT}_scr-c`);
  });

  it('does not depend on the order rows came back in, and drops duplicates', () => {
    const one = screenListMessageIds(ROOT, ['scr-b', 'scr-a', 'scr-a']);
    const two = screenListMessageIds(ROOT, ['scr-a', 'scr-b']);
    expect([...one.entries()]).toEqual([...two.entries()]);
    expect(one.size).toBe(2);
  });

  it('every id it makes belongs to the same send', () => {
    for (const id of screenListMessageIds(ROOT, ['x', 'y', 'z']).values()) {
      expect(sendRootIdOf(id)).toBe(ROOT);
    }
  });
});

describe('isScreenListRow', () => {
  it('is a device-scoped text broadcast with a send id', () => {
    expect(isScreenListRow({ id: ROOT, type: 'TEXT_BROADCAST', scopeType: 'device' })).toBe(true);
    expect(isScreenListRow({ id: `${ROOT}_scr`, type: 'TEXT_BROADCAST', scopeType: 'device' })).toBe(true);
  });
  it('is not a tenant-scoped copy, an SOS, or a media alert', () => {
    expect(isScreenListRow({ id: ROOT, type: 'TEXT_BROADCAST', scopeType: 'tenant' })).toBe(false);
    expect(isScreenListRow({ id: `sos_${UUID}`, type: 'SOS', scopeType: 'device' })).toBe(false);
    expect(isScreenListRow({ id: `media_${UUID}`, type: 'MEDIA_ALERT', scopeType: 'device' })).toBe(false);
  });
});

describe('groupScreenListSends', () => {
  const row = (id: string, paneId: string, tenantId = 't1'): ScreenListRow => ({
    id,
    type: 'TEXT_BROADCAST',
    scopeType: 'device',
    scopeId: paneId,
    tenantId,
  });
  const facts = (list: ScreenFact[]) => new Map(list.map((f) => [f.id, f]));

  it('one send over three panes of two displays is TWO screens, named', () => {
    const rows = [row(ROOT, 'lobby'), row(`${ROOT}_lobby-back`, 'lobby-back'), row(`${ROOT}_gym`, 'gym')];
    const grouped = groupScreenListSends(
      rows,
      facts([
        { id: 'lobby', name: 'Lobby' },
        { id: 'lobby-back', name: 'Lobby (back)', faceOfScreenId: 'lobby' },
        { id: 'gym', name: 'Gym' },
      ]),
    );
    const send = grouped.get(ROOT)!;
    expect(send.screenCount).toBe(2);
    expect(send.screens.map((s) => s.name)).toEqual(['Gym', 'Lobby']);
    expect(send.paneIds).toEqual(['gym', 'lobby', 'lobby-back']);
  });

  it('a face whose front is NOT in the set stands for itself (nothing is dropped from the count)', () => {
    const grouped = groupScreenListSends(
      [row(ROOT, 'back-only')],
      facts([{ id: 'back-only', name: 'Back side', faceOfScreenId: 'front-elsewhere' }]),
    );
    expect(grouped.get(ROOT)!.screenCount).toBe(1);
    expect(grouped.get(ROOT)!.screens[0]).toEqual({ id: 'back-only', name: 'Back side' });
  });

  it('keeps separate sends separate, and ignores rows that are not screen-list ids', () => {
    const rows = [
      row(ROOT, 'a'),
      row(`bcast_${OTHER_UUID}`, 'b'),
      { id: `sos_${UUID}`, type: 'SOS', scopeType: 'device', scopeId: 'c', tenantId: 't1' },
    ];
    const grouped = groupScreenListSends(rows, facts([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]));
    expect([...grouped.keys()].sort()).toEqual([ROOT, `bcast_${OTHER_UUID}`].sort());
  });

  it('a screen it has no facts for is still counted (by id)', () => {
    const grouped = groupScreenListSends([row(ROOT, 'mystery')], new Map());
    expect(grouped.get(ROOT)!.screenCount).toBe(1);
    expect(grouped.get(ROOT)!.screens[0]).toEqual({ id: 'mystery', name: null });
  });
});
