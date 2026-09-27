/**
 * Render-level proof for RenderTrustChip — the logic is pinned in
 * renderTrust.test.ts; this proves the CHIP actually shows the right
 * words for an operator, and that the offline case renders nothing rather
 * than stacking a second message next to the existing OFFLINE badge.
 */
import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';
import { RenderTrustChip } from '../RenderTrustChip';
import type { ContentDownload } from '../contentDownload';

describe('RenderTrustChip', () => {
  it('painting: shows the green "Showing content ✓ · checked …" line', () => {
    render(
      <RenderTrustChip
        status="ONLINE"
        renderHealth="OK"
        renderStale={false}
        verifiedAgo="18s ago"
        verifiedFull="Aug 24, 2026 6:50:03 PM"
      />,
    );
    expect(rtl.getByText('Showing content ✓ · checked 18s ago')).toBeInTheDocument();
  });

  it('painting: omits the "verified" clause when no timestamp is available', () => {
    render(<RenderTrustChip status="ONLINE" renderHealth="OK" renderStale={false} />);
    expect(rtl.getByText('Showing content ✓')).toBeInTheDocument();
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
      rtl.getByText('No picture confirmed · last picture 6m ago — still responds'),
    ).toBeInTheDocument();
  });

  it('unknown: shows the quiet neutral awaiting-player-update line', () => {
    render(<RenderTrustChip status="ONLINE" renderHealth="UNKNOWN" renderStale={false} />);
    expect(rtl.getByText(/Can’t confirm picture yet · older player/)).toBeInTheDocument();
  });

  it('offline: renders nothing (no double-alarm next to the existing OFFLINE badge)', () => {
    const { container } = render(
      <RenderTrustChip status="OFFLINE" renderHealth="STALE" renderStale={true} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

// ── 2026-09-27: the idle proofs say what they are ────────────────────────
// Every `idle:` proof used to render "Screen on · nothing scheduled yet".
describe('RenderTrustChip — downloads and the player\'s own states (2026-09-27)', () => {
  const MB = 1024 * 1024;
  const download = (over: Partial<ContentDownload> = {}): ContentDownload => ({
    state: 'downloading', fileName: 'promo.mp4', bytesLoaded: 87 * MB, bytesTotal: 141 * MB, percent: 62, ...over,
  });
  const chip = (hash: string, extra: Partial<React.ComponentProps<typeof RenderTrustChip>> = {}) =>
    render(<RenderTrustChip status="ONLINE" renderHealth="OK" renderStale={false} lastRenderedHash={hash} {...extra} />);
  const noGreen = (el: HTMLElement) => expect(el.className).not.toMatch(/emerald/);

  it('downloading: the splash\'s own state, with live progress when the snapshot is fresh', () => {
    chip('idle:content-downloading', { download: download(), verifiedAgo: '1m ago' });
    const el = rtl.getByText('Downloading new content · 62% of 141 MB · 1m ago');
    noGreen(el);
    expect(rtl.queryByText(/nothing scheduled/i)).toBeNull();
  });

  it('downloading with no fresh snapshot: says so, claims no number', () => {
    chip('idle:content-downloading', { download: download({ state: 'stale' }) });
    expect(rtl.getByText('Downloading new content')).toBeInTheDocument();
    expect(rtl.queryByText(/62%/)).toBeNull();
  });

  it('held: the old content paints, but the chip is not the green "Showing content ✓"', () => {
    chip('pl:0|10000|old', { download: download({ state: 'held' }) });
    const el = rtl.getByText('Still showing previous content · new content 62% of 141 MB');
    noGreen(el);
    expect(rtl.queryByText(/Showing content ✓/)).toBeNull();
  });

  it('a STALE hold changes nothing: the painting chip stays as it was', () => {
    chip('pl:0|10000|old', { download: download({ state: 'stale' }) });
    expect(rtl.getByText('Showing content ✓')).toBeInTheDocument();
  });

  it('content unavailable: rose, never green, never "nothing scheduled"', () => {
    chip('idle:content-unavailable');
    const el = rtl.getByText('Content unavailable');
    expect(el.closest('span')!.className).toMatch(/rose/);
    noGreen(el.closest('span')!);
  });

  it('connecting and loading say exactly that', () => {
    chip('idle:connecting');
    expect(rtl.getByText('Screen on · connecting')).toBeInTheDocument();
  });

  it('loading says exactly that', () => {
    chip('idle:content-loading');
    expect(rtl.getByText('Loading content')).toBeInTheDocument();
  });

  it('nothing scheduled still reads as before', () => {
    chip('idle:playing');
    expect(rtl.getByText('Screen on · nothing scheduled yet')).toBeInTheDocument();
  });
});
