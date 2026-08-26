import { render, screen, fireEvent } from '@testing-library/react';
import { LogoBackgroundPicker } from '../BrandingWizard';

/**
 * The wizard's THIRD picker, rendered (2026-08-25).
 *
 * CLAUDE.md #9 — "VERIFY THE RENDER TREE": a control that type-checks but
 * never mounts ships nothing. `LogoBackgroundPicker` is mounted inside
 * `BrandingWizard`, which mounts on /demo/branding, /onboarding/branding and
 * /[schoolId]/settings/branding. This suite proves the control itself
 * renders, pre-selects the server's default, and reports operator overrides.
 */

const noop = () => {};

describe('LogoBackgroundPicker — renders as a real picker', () => {
  it('renders one tile per offered background', () => {
    render(
      <LogoBackgroundPicker logoUrl="https://acmelotus.com/lotus.png" logoSvg={null} value={null} autoFromServer="white" onChange={noop} />,
    );
    for (const label of ['None', 'White', 'Dark', 'Brand', 'Tile']) {
      expect(screen.getByRole('button', { name: `Logo background: ${label}` })).toBeInTheDocument();
    }
  });

  it('pre-selects the server\'s computed default when the operator has not chosen', () => {
    render(
      <LogoBackgroundPicker logoUrl="https://acmelotus.com/lotus.png" logoSvg={null} value={null} autoFromServer="white" onChange={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Logo background: White' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Logo background: Dark' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('tells the operator which one we picked for them ("do our best to get it right")', () => {
    render(
      <LogoBackgroundPicker logoUrl="https://acmelotus.com/lotus.png" logoSvg={null} value={null} autoFromServer="dark" onChange={noop} />,
    );
    const hint = screen.getByText(/We picked/i);
    expect(hint).toBeInTheDocument();
    // The hint NAMES the option, so the operator knows what "auto" resolved to.
    expect(hint.textContent).toMatch(/We picked\s*Dark\s*for this logo/);
  });

  it('an operator choice overrides the server default', () => {
    render(
      <LogoBackgroundPicker logoUrl="https://acmelotus.com/lotus.png" logoSvg={null} value="transparent" autoFromServer="primary" onChange={noop} />,
    );
    expect(screen.getByRole('button', { name: 'Logo background: None' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Logo background: Brand' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the click so the wizard can persist it', () => {
    const onChange = jest.fn();
    render(
      <LogoBackgroundPicker logoUrl="https://acmelotus.com/lotus.png" logoSvg={null} value={null} autoFromServer="white" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Logo background: Dark' }));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('previews the ACTUAL chosen mark on every tile (choice by sight, not by label)', () => {
    render(
      <LogoBackgroundPicker logoUrl="https://acmelotus.com/lotus.png" logoSvg={null} value={null} autoFromServer="white" onChange={noop} />,
    );
    const imgs = document.querySelectorAll('img[src="https://acmelotus.com/lotus.png"]');
    expect(imgs).toHaveLength(5);
  });

  it('renders an inline-SVG mark on every tile too', () => {
    render(
      <LogoBackgroundPicker
        logoUrl={null}
        logoSvg={'<svg viewBox="0 0 10 10"><path fill="#c2185b" d="M0 0h10v10H0z"/></svg>'}
        value={null}
        autoFromServer="dark"
        onChange={noop}
      />,
    );
    expect(document.querySelectorAll('svg path[fill="#c2185b"]').length).toBe(5);
  });

  it('falls back to the tone rule when the server sent no default (manual upload path)', () => {
    render(<LogoBackgroundPicker logoUrl={null} logoSvg={null} value={null} autoFromServer={null} onChange={noop} />);
    // useLogoTone reports 'unknown' with no source → the brand chip, which is
    // exactly the treatment that shipped before the picker existed.
    expect(screen.getByRole('button', { name: 'Logo background: Brand' })).toHaveAttribute('aria-pressed', 'true');
  });
});
