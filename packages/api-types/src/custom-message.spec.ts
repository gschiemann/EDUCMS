import {
  BroadcastInputSchema,
  CUSTOM_MESSAGE_MAX_SCREENS,
  CUSTOM_MESSAGE_SEVERITIES,
  customMessageSeverity,
  isBannerSeverity,
} from './index';

describe('custom message — Info / Critical', () => {
  it('offers exactly two kinds to an operator', () => {
    expect([...CUSTOM_MESSAGE_SEVERITIES]).toEqual(['INFO', 'CRITICAL']);
  });

  it('reads the older WARN value as Info (the player has always drawn both as a top banner)', () => {
    expect(customMessageSeverity('INFO')).toBe('INFO');
    expect(customMessageSeverity('WARN')).toBe('INFO');
    expect(customMessageSeverity('warn')).toBe('INFO');
    expect(customMessageSeverity('CRITICAL')).toBe('CRITICAL');
  });

  it('fails toward over-alerting: anything it does not recognise is Critical, like the player', () => {
    expect(customMessageSeverity('URGENT')).toBe('CRITICAL');
    expect(customMessageSeverity('')).toBe('CRITICAL');
    expect(customMessageSeverity(null)).toBe('CRITICAL');
    expect(customMessageSeverity(undefined)).toBe('CRITICAL');
  });

  it('only Info is a banner', () => {
    expect(isBannerSeverity('INFO')).toBe(true);
    expect(isBannerSeverity('WARN')).toBe(true);
    expect(isBannerSeverity('CRITICAL')).toBe(false);
  });
});

describe('BroadcastInputSchema — specific screens (additive)', () => {
  const base = { scopeType: 'tenant' as const, scopeId: 'tenant-1', text: 'Assembly moved to 2 pm.' };

  it('keeps accepting every request clients have always sent', () => {
    for (const severity of ['INFO', 'WARN', 'CRITICAL'] as const) {
      expect(BroadcastInputSchema.safeParse({ ...base, severity }).success).toBe(true);
    }
    expect(BroadcastInputSchema.safeParse({ ...base }).success).toBe(true);
    expect(BroadcastInputSchema.safeParse({ scopeType: 'group', scopeId: 'g1', text: 'x' }).success).toBe(true);
    expect(BroadcastInputSchema.safeParse({ scopeType: 'device', scopeId: 'd1', text: 'x' }).success).toBe(true);
  });

  it('takes a list of screen ids with a tenant scope', () => {
    const parsed = BroadcastInputSchema.safeParse({ ...base, screenIds: ['s1', 's2'] });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.screenIds).toEqual(['s1', 's2']);
  });

  it('refuses a list with a group or device scope (the scope names the sender, never the audience)', () => {
    expect(BroadcastInputSchema.safeParse({ ...base, scopeType: 'group', screenIds: ['s1'] }).success).toBe(false);
    expect(BroadcastInputSchema.safeParse({ ...base, scopeType: 'device', screenIds: ['s1'] }).success).toBe(false);
  });

  it('refuses an empty list (that would silently mean "nobody")', () => {
    expect(BroadcastInputSchema.safeParse({ ...base, screenIds: [] }).success).toBe(false);
  });

  it('bounds the list', () => {
    const ok = Array.from({ length: CUSTOM_MESSAGE_MAX_SCREENS }, (_, i) => `s${i}`);
    expect(BroadcastInputSchema.safeParse({ ...base, screenIds: ok }).success).toBe(true);
    expect(BroadcastInputSchema.safeParse({ ...base, screenIds: [...ok, 'one-too-many'] }).success).toBe(false);
  });

  it('is still strict about unknown keys', () => {
    expect(BroadcastInputSchema.safeParse({ ...base, audience: 'everyone' }).success).toBe(false);
  });
});
