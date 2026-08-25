/**
 * Render-level proof for RenderTrustChip — the logic is pinned in
 * renderTrust.test.ts; this proves the CHIP actually shows the right
 * words for an operator, and that the offline case renders nothing rather
 * than stacking a second message next to the existing OFFLINE badge.
 */
import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';
import { RenderTrustChip } from '../RenderTrustChip';

describe('RenderTrustChip', () => {
  it('painting: shows the green "Rendering ✓ · verified …" line', () => {
    render(
      <RenderTrustChip
        status="ONLINE"
        renderHealth="OK"
        renderStale={false}
        verifiedAgo="18s ago"
        verifiedFull="Aug 24, 2026 6:50:03 PM"
      />,
    );
    expect(rtl.getByText('Rendering ✓ · verified 18s ago')).toBeInTheDocument();
  });

  it('painting: omits the "verified" clause when no timestamp is available', () => {
    render(<RenderTrustChip status="ONLINE" renderHealth="OK" renderStale={false} />);
    expect(rtl.getByText('Rendering ✓')).toBeInTheDocument();
  });

  it('THE MONEY STATE: not-painting shows the unmissable reachable-but-frozen line', () => {
    render(
      <RenderTrustChip
        status="ONLINE"
        renderHealth="STALE"
        renderStale={true}
        verifiedAgo="6m ago"
      />,
    );
    expect(
      rtl.getByText('Reachable — but not painting (last verified 6m ago)'),
    ).toBeInTheDocument();
  });

  it('unknown: shows the quiet neutral awaiting-player-update line', () => {
    render(<RenderTrustChip status="ONLINE" renderHealth="UNKNOWN" renderStale={false} />);
    expect(rtl.getByText('Render-proof: awaiting player update')).toBeInTheDocument();
  });

  it('offline: renders nothing (no double-alarm next to the existing OFFLINE badge)', () => {
    const { container } = render(
      <RenderTrustChip status="OFFLINE" renderHealth="STALE" renderStale={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
