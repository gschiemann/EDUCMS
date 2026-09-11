/**
 * Variant registry integrity (2026-09-11).
 *
 * THE BUG CLASS THIS PINS: `registerVariant` was a bare
 * `variants.set(v.id, v)`, so two registrations claiming one id collapsed to
 * whichever ran last — silently. One collision was live on master
 * (`retail-loyalty-qr`: the ALL_V2_WIDGETS loop at variants-register.ts:1092
 * registers it under canonical RETAIL, the static block at :1889 clobbers it
 * under RETAIL_LOYALTY_QR). Nothing logged, nothing failed, and the operator
 * who picked the losing tile got the winning widget on the wall.
 *
 * The registry cannot THROW on this — it loads in the player, at module
 * scope, and a throw blanks every variant-rendered zone in the fleet. So it
 * records, and these assertions plus
 * `apps/web/tools/check-variant-registry.cjs` are the gate.
 */
import '@/components/widgets/variants-register';
import {
  registerVariant,
  getVariant,
  listVariants,
  listVariantIdCollisions,
} from '@/components/widgets/variants';

// Snapshot the real registry BEFORE any probe registration below mutates it.
const realCollisions = listVariantIdCollisions();
const realVariants = listVariants();

describe('variant registry — duplicate ids', () => {
  it('has exactly the collisions the CI baseline records, and no others', () => {
    // Kept in step with apps/web/tools/variant-registry-baseline.json. A new
    // collision fails here AND in the guard; the two must never disagree.
    //
    // 2026-09-11 — this list is now EMPTY, and the fix is worth stating because
    // it generalises. `retail-loyalty-qr` was claimed by the ALL_V2_WIDGETS
    // loop and again by the static retail block. Last-wins meant the static
    // one held the id and the v2 tile was invisible in the picker. Renaming
    // the WINNER would have orphaned every saved zone holding the id; renaming
    // the LOSER cost nothing, because no zone could ever have resolved to a
    // registration that was overwritten at module-eval time. So the id still
    // resolves to precisely the renderer it did before, and a tile that was
    // being silently eaten came back (701 → 702).
    expect(realCollisions.map((c) => `${c.id}|${c.lostWidgetType}|${c.keptWidgetType}`)).toEqual([]);
  });

  it('keeps "retail-loyalty-qr" pointing at the renderer saved boards already show', () => {
    // The whole safety argument for the rename above is that this id did not
    // move. If someone "fixes" a future collision by renaming the winner, this
    // fails and says why before it reaches a customer's wall.
    expect(getVariant('retail-loyalty-qr')?.widgetType).toBe('RETAIL_LOYALTY_QR');
    // …and the registration that used to be eaten is now reachable.
    expect(getVariant('retail-loyalty-qr-card')).toBeTruthy();
  });

  it('records a duplicate registration instead of throwing', () => {
    const before = listVariantIdCollisions().length;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const existing = realVariants[0];

    expect(() =>
      registerVariant({ ...existing, name: 'Probe Duplicate' }),
    ).not.toThrow();

    const after = listVariantIdCollisions();
    expect(after).toHaveLength(before + 1);
    expect(after[after.length - 1]).toMatchObject({
      id: existing.id,
      keptName: 'Probe Duplicate',
      lostName: existing.name,
    });
    // Loud, not silent — this is the only runtime signal a player gets.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(`DUPLICATE variant id "${existing.id}"`));

    // …and LAST still wins. Which registration wins decides what is on glass;
    // flipping it would silently re-point every zone holding that id.
    expect(getVariant(existing.id)!.name).toBe('Probe Duplicate');
    registerVariant(existing); // restore for any later assertion in this file
    spy.mockRestore();
  });
});

describe('variant registry — renderers', () => {
  it('gives every registered variant a real renderer', () => {
    // A variant with no renderer still shows a tile in VariantPicker, but the
    // canvas falls through to the plain type dispatch — the same "picked A,
    // got B" failure as a lost id, arriving through an `as any` cast that the
    // type checker cannot see.
    const broken = realVariants.filter((v) => typeof v.render !== 'function');
    expect(broken.map((v) => `${v.id} (${v.widgetType})`)).toEqual([]);
  });

  it('registered a non-trivial catalog (guards against an empty-registry false green)', () => {
    expect(realVariants.length).toBeGreaterThan(600);
  });
});
