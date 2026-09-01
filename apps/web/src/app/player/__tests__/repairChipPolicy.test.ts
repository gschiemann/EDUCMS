/**
 * Placement policy for the "Re-pair required" chip.
 *
 * Two failure modes are worth pinning, and they pull in opposite directions:
 *
 *   (a) OVER-CLAIMING SILENCE — the chip disappearing while the credential
 *       is still unproven AND the operator is looking at a diagnostic
 *       surface. That is the 1.1.6 failure class (a screen sat ONLINE and
 *       content-dead for days behind an ignored `requiresRePair`), so the
 *       operator surfaces must show it unconditionally and forever.
 *
 *   (b) ADMIN STATE ON PUBLIC GLASS — the chip painting an amber box over a
 *       lobby board all day for a condition the public cannot act on. Only
 *       the 5-minute walk-up window buys an exception there.
 *
 * All four quadrants of (repairRequired × onOperatorSurface) are covered,
 * plus the boundary itself — an off-by-one at the window edge is the kind of
 * thing that either strands the chip forever or kills the walk-up diagnostic.
 */

import {
  shouldShowRepairChip,
  REPAIR_CHIP_BOOT_WINDOW_MS,
} from '../repairChipPolicy';

describe('shouldShowRepairChip', () => {
  describe('truth gate — nothing renders when the server did not say so', () => {
    it('is false on an operator surface when the credential is fine', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: false,
          onOperatorSurface: true,
          msSinceBoot: 0,
        }),
      ).toBe(false);
    });

    it('is false over live content when the credential is fine', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: false,
          onOperatorSurface: false,
          msSinceBoot: 0,
        }),
      ).toBe(false);
    });

    it('stays false forever when the credential is fine, boot window or not', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: false,
          onOperatorSurface: false,
          msSinceBoot: REPAIR_CHIP_BOOT_WINDOW_MS * 100,
        }),
      ).toBe(false);
    });
  });

  describe('operator surfaces — the durable telling, never expires', () => {
    it('shows at boot', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: true,
          msSinceBoot: 0,
        }),
      ).toBe(true);
    });

    it('still shows a full day after boot', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: true,
          msSinceBoot: 24 * 60 * 60_000,
        }),
      ).toBe(true);
    });
  });

  describe('live public content — boot window only', () => {
    it('shows immediately after a power-cycle (walk-up diagnostic)', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: false,
          msSinceBoot: 0,
        }),
      ).toBe(true);
    });

    it('still shows one millisecond inside the window', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: false,
          msSinceBoot: REPAIR_CHIP_BOOT_WINDOW_MS - 1,
        }),
      ).toBe(true);
    });

    it('leaves the glass exactly at the boundary', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: false,
          msSinceBoot: REPAIR_CHIP_BOOT_WINDOW_MS,
        }),
      ).toBe(false);
    });

    it('stays off the glass long after the window closed', () => {
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: false,
          msSinceBoot: REPAIR_CHIP_BOOT_WINDOW_MS + 60_000,
        }),
      ).toBe(false);
    });

    it('comes straight back when the operator opens a diagnostic surface later', () => {
      const lateBoot = REPAIR_CHIP_BOOT_WINDOW_MS * 10;
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: false,
          msSinceBoot: lateBoot,
        }),
      ).toBe(false);
      expect(
        shouldShowRepairChip({
          repairRequired: true,
          onOperatorSurface: true,
          msSinceBoot: lateBoot,
        }),
      ).toBe(true);
    });
  });

  it('holds the documented window at five minutes', () => {
    expect(REPAIR_CHIP_BOOT_WINDOW_MS).toBe(5 * 60_000);
  });
});
