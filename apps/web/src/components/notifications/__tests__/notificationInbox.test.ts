/**
 * §M21 categorisation — the derivation, pinned against what the server
 * ACTUALLY emits rather than against the enum it declares.
 *
 * The trap this suite exists for: `kind` looks like it should be the category
 * key, and it isn't. Both halves of the review workflow ship as `kind: 'INFO'`
 * (submissions.controller.ts:158 to the reviewer, :407 back to the author),
 * told apart only by their link. A future refactor that "simplifies"
 * categorize() down to a switch on `kind` files every review under System
 * updates, and nothing else in the suite would notice.
 */
import {
  buildInbox, categorize, relativeAge, CATEGORY_LABEL,
  type InboxNotification,
} from '../notificationInbox';

function n(over: Partial<InboxNotification> = {}): InboxNotification {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'INFO',
    title: 'Something happened',
    body: null,
    link: null,
    isRead: false,
    createdAt: new Date('2026-09-01T12:00:00Z').toISOString(),
    ...over,
  };
}

describe('categorize — against the real emission sites', () => {
  it('files an offline screen under delivery exceptions', () => {
    // notifications.service.ts:271 (store) and :284 (HQ roll-up).
    expect(categorize(n({ kind: 'SCREEN_OFFLINE', link: '/screens' }))).toBe('exceptions');
  });

  it('files the declared-but-unemitted SYNC_FAILED there too, in case it ever lands', () => {
    expect(categorize(n({ kind: 'SYNC_FAILED' }))).toBe('exceptions');
  });

  /**
   * THE ONE THAT MATTERS. Both of these are `kind: 'INFO'` on the wire.
   */
  it('files a reviewer’s "awaiting your review" under Reviews, though its kind is INFO', () => {
    // submissions.controller.ts:158 / schedules.controller.ts:407
    const row = n({ kind: 'INFO', title: 'New submission awaiting your review', link: '/reviews?id=sub_1' });
    expect(row.kind).toBe('INFO');
    expect(categorize(row)).toBe('reviews');
  });

  it('files the author’s decision notice under Reviews too', () => {
    // submissions.controller.ts:407
    expect(categorize(n({ kind: 'INFO', title: 'Your submission was approved', link: '/submissions/sub_1' }))).toBe('reviews');
  });

  it('files licence and platform messages under System updates', () => {
    // super-license.controller.ts:85 / notifications.service.ts:315
    expect(categorize(n({ kind: 'INFRA_EVENT', link: null }))).toBe('system');
  });

  it('files a link-less INFO under System updates rather than guessing', () => {
    expect(categorize(n({ kind: 'INFO', link: null }))).toBe('system');
  });

  it('does not mistake a lookalike path for a review link', () => {
    expect(categorize(n({ link: '/reviewsomething' }))).toBe('system');
    expect(categorize(n({ link: '/submissionsxyz' }))).toBe('system');
    // …but the real shapes all match.
    for (const l of ['/reviews', '/reviews?id=1', '/reviews/1', '/submissions/1']) {
      expect(categorize(n({ link: l }))).toBe('reviews');
    }
  });
});

describe('buildInbox', () => {
  const rows = [
    n({ id: 'a', kind: 'SCREEN_OFFLINE', createdAt: '2026-09-01T10:00:00Z', isRead: false }),
    n({ id: 'b', kind: 'INFO', link: '/reviews?id=1', createdAt: '2026-09-01T12:00:00Z', isRead: true }),
    n({ id: 'c', kind: 'INFRA_EVENT', createdAt: '2026-09-01T11:00:00Z', isRead: false }),
    n({ id: 'd', kind: 'SCREEN_OFFLINE', createdAt: '2026-09-01T09:00:00Z', isRead: true }),
  ];

  it('sorts newest first', () => {
    expect(buildInbox(rows).rows.map((r) => r.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('counts each tab off the same categorisation the rows carry', () => {
    const inbox = buildInbox(rows);
    expect(inbox.tabs.map((t) => [t.key, t.count, t.unread])).toEqual([
      ['all', 4, 2],
      ['exceptions', 2, 1],
      ['reviews', 1, 0],
      ['system', 1, 1],
    ]);
    // Per-tab counts must reconcile with the whole — a tab total that drifts
    // from the row list is how a badge starts lying.
    const perTab = inbox.tabs.filter((t) => t.key !== 'all').reduce((a, t) => a + t.count, 0);
    expect(perTab).toBe(inbox.rows.length);
    expect(inbox.unreadTotal).toBe(2);
  });

  it('labels the three tabs in universal nouns — no school vocabulary (§14.1)', () => {
    for (const label of Object.values(CATEGORY_LABEL)) {
      expect(label).not.toMatch(/school|district|classroom|student|teacher/i);
    }
  });

  it('survives an absent list rather than throwing at the render', () => {
    for (const empty of [undefined, null, []]) {
      const inbox = buildInbox(empty as never);
      expect(inbox.rows).toEqual([]);
      expect(inbox.unreadTotal).toBe(0);
      expect(inbox.tabs.every((t) => t.count === 0)).toBe(true);
    }
  });

  it('keeps an unparseable timestamp at the bottom instead of corrupting the order', () => {
    const inbox = buildInbox([...rows, n({ id: 'bad', createdAt: 'not-a-date' })]);
    expect(inbox.rows[inbox.rows.length - 1].id).toBe('bad');
    expect(inbox.rows).toHaveLength(5);
  });
});

describe('relativeAge', () => {
  const NOW = new Date('2026-09-01T12:00:00Z').getTime();
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it.each([
    [30 * 1000, 'just now'],
    [5 * 60_000, '5m ago'],
    [3 * 3_600_000, '3h ago'],
    [2 * 86_400_000, '2d ago'],
  ])('renders %sms as %s', (ms, expected) => {
    expect(relativeAge(ago(ms as number), NOW)).toBe(expected);
  });

  /**
   * Clock skew is real on the devices around this platform. "in -4m ago" is
   * worse than no timestamp, so a future stamp reports nothing at all.
   */
  it('says nothing rather than a negative age when the stamp is in the future', () => {
    expect(relativeAge(new Date(NOW + 60_000).toISOString(), NOW)).toBeNull();
  });

  it('says nothing for an unparseable stamp', () => {
    expect(relativeAge('not-a-date', NOW)).toBeNull();
  });
});
