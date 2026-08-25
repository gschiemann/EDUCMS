/**
 * Render-level proof for BundleSkewChip — the grading is pinned in
 * bundleSkew.test.ts; this proves the CHIP shows the right words, wires the
 * Refresh action, and — the part that matters most on a page that already
 * had an alarm-fatigue problem — stays QUIET in every non-actionable state
 * and never wears alarm styling.
 */
import * as React from 'react';
import { render, screen as rtl, fireEvent } from '@testing-library/react';
import { BundleSkewChip } from '../BundleSkewChip';

const SHA_A = 'abc123def456';
const SHA_B = '94b94ac8aaaa';

describe('BundleSkewChip', () => {
  it('stale: names the condition and offers the Refresh action', () => {
    const onRefresh = jest.fn();
    const { container } = render(
      <BundleSkewChip
        status="ONLINE"
        reportedSha={SHA_A}
        deployedSha={SHA_B}
        onRefresh={onRefresh}
      />,
    );
    expect(rtl.getByText('Page bundle out of date')).toBeInTheDocument();

    const btn = rtl.getByRole('button', { name: 'Refresh' });
    fireEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);

    // NEVER RED. A stale bundle is a normal, self-healing state every panel
    // passes through after every deploy; dressing it as an alert is the
    // crying-wolf failure the render-proof chip was graded down for hours
    // before this shipped.
    const html = container.innerHTML;
    expect(html).not.toMatch(/rose|red-/);
    expect(html).toMatch(/slate/);
  });

  it('stale: shows a pending state instead of firing Refresh twice', () => {
    const onRefresh = jest.fn();
    render(
      <BundleSkewChip
        status="ONLINE"
        reportedSha={SHA_A}
        deployedSha={SHA_B}
        onRefresh={onRefresh}
        refreshPending
      />,
    );
    const btn = rtl.getByRole('button', { name: 'Refreshing…' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('stale: still tells the truth when the caller has no Refresh handler', () => {
    render(<BundleSkewChip status="ONLINE" reportedSha={SHA_A} deployedSha={SHA_B} />);
    expect(rtl.getByText('Page bundle out of date')).toBeInTheDocument();
    expect(rtl.queryByRole('button')).toBeNull();
  });

  it('current: renders NOTHING — no chip on every row forever', () => {
    const { container } = render(
      <BundleSkewChip status="ONLINE" reportedSha={SHA_A} deployedSha={SHA_A} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('unknown (no reported SHA): renders NOTHING — never accuses on absence', () => {
    const { container } = render(
      <BundleSkewChip status="ONLINE" reportedSha={null} deployedSha={SHA_B} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('unknown (no deployed SHA): renders NOTHING — the whole-fleet false alarm', () => {
    const { container } = render(
      <BundleSkewChip status="ONLINE" reportedSha={SHA_A} deployedSha={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('offline: renders NOTHING — the OFFLINE badge already owns that row', () => {
    for (const status of ['OFFLINE', 'PENDING', 'REVOKED']) {
      const { container } = render(
        <BundleSkewChip status={status} reportedSha={SHA_A} deployedSha={SHA_B} />,
      );
      expect(container.firstChild).toBeNull();
    }
  });
});
