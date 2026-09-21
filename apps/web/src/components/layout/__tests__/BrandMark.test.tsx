/**
 * <BrandMark /> — the one tenant logo renderer, graded branch by branch.
 *
 * These matter because the branches are a FALLBACK CHAIN and every link in it
 * was added after a real failure: a rehosted logo that 404s, a wordmark whose
 * natural dimensions come back 0, a tenant with a name but no mark, and the
 * unbranded default. A regression in any one of them shows up as "the operator
 * sees blank space where their logo should be" — which is exactly the report
 * that created this component (2026-09-21, phone).
 *
 * Branding is seeded through the REAL resolution path (the per-tenant
 * localStorage cache <BrandStyleInjector /> writes) rather than a mocked hook,
 * so the test would notice if that contract moved.
 */
import { render, screen, act, fireEvent } from '@testing-library/react';
import { BrandMark } from '../BrandMark';
import { useAppStore } from '@/lib/store';

const LS_KEY = 'edu-cms-branding-cache-v1:t1';

function seedTenant() {
  act(() => {
    useAppStore.setState({
      user: {
        id: 'u1', email: 'a@b.c', role: 'DISTRICT_ADMIN', tenantId: 't1', canTriggerPanic: false,
      } as never,
    });
  });
}

function seedBranding(b: Record<string, unknown>) {
  window.localStorage.setItem(LS_KEY, JSON.stringify(b));
}

beforeEach(() => {
  window.localStorage.clear();
  seedTenant();
});

describe('the unbranded default', () => {
  it('draws the VenueOS mark — the same one the login and marketing chrome use', () => {
    render(<BrandMark />);
    expect(screen.getByTestId('brandmark-default')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });

  it('leaks no brand styling when the tenant has no branding row', () => {
    const { container } = render(<BrandMark size="sm" />);
    // A brand-primary chip behind an unbranded mark would be a visible change
    // for every tenant who has not set anything up.
    expect(container.querySelector('[style*="brand-primary"]')).toBeNull();
  });
});

describe('the image branch', () => {
  it('renders the rehosted logo', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/logo.png' });
    render(<BrandMark />);
    const img = document.querySelector('img')!;
    expect(img).toHaveAttribute('src', 'https://cdn.test/logo.png');
    expect(screen.queryByTestId('brandmark-default')).toBeNull();
  });

  it('a 404 on the rehosted logo falls back to a brand-primary initials chip, never to the product mark', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/gone.png' });
    const { container } = render(<BrandMark />);
    act(() => { fireEvent.error(document.querySelector('img')!); });

    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('IP')).toBeInTheDocument();
    // They DID adopt a brand — reverting to the VenueOS hex would read as
    // "we forgot you exist" (2026-05-26, round 7).
    expect(screen.queryByTestId('brandmark-default')).toBeNull();
    expect(container.querySelector('[style*="brand-primary"]')).not.toBeNull();
  });

  it('an .ico is not treated as a logo — it falls through to the named-initials chip', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/favicon.ico' });
    render(<BrandMark />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('IP')).toBeInTheDocument();
  });
});

describe('the inline-SVG branch', () => {
  it('renders the sanitized mark inline and does not also draw an <img>', () => {
    seedBranding({
      displayName: 'Iron Peak',
      logoSvgInline: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="#123456"/></svg>',
    });
    const { container } = render(<BrandMark />);
    expect(container.querySelector('svg path')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('strips a script out of a hostile inline SVG', () => {
    seedBranding({
      displayName: 'Iron Peak',
      logoSvgInline: '<svg><path d="M0 0"/><script>window.__pwned = 1</script></svg>',
    });
    const { container } = render(<BrandMark />);
    expect(container.querySelector('svg path')).not.toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});

describe('the named-but-logoless tenant', () => {
  it('shows their initials on brand primary rather than the product mark', () => {
    seedBranding({ displayName: 'Walnut Creek' });
    render(<BrandMark />);
    expect(screen.getByText('WC')).toBeInTheDocument();
    expect(screen.queryByTestId('brandmark-default')).toBeNull();
  });

  it('decodes an entity-escaped display name (the dominos.com "&amp;" scrape)', () => {
    seedBranding({ displayName: 'Pizza &amp; Carryout' });
    render(<BrandMark showName />);
    expect(screen.getByText('Pizza & Carryout')).toBeInTheDocument();
  });
});

describe('what a screen reader hears', () => {
  it('a standalone mark is announced with the organisation name', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/logo.png' });
    render(<BrandMark />);
    expect(screen.getByRole('img', { name: 'Iron Peak' })).toBeInTheDocument();
    // The inner <img> stays alt="" — the wrapper carries the label, so the
    // name is announced once, not twice.
    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('showName prints the name and stops the mark announcing it a second time', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/logo.png' });
    render(<BrandMark showName />);
    expect(screen.getByText('Iron Peak')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Iron Peak' })).toBeNull();
  });

  it('`decorative` silences the mark for a caller that prints the name itself (the Sidebar)', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/logo.png' });
    render(<BrandMark decorative />);
    expect(screen.queryByRole('img', { name: 'Iron Peak' })).toBeNull();
    expect(document.querySelector('img')).toHaveAttribute('alt', '');
  });
});

describe('the caller-supplied identity (how the Sidebar keeps owning its own read)', () => {
  it('wins over anything in storage', () => {
    seedBranding({ displayName: 'From Storage', logoUrl: 'https://cdn.test/storage.png' });
    render(
      <BrandMark
        identity={{
          mounted: true,
          brandName: 'From Caller',
          isCustomName: true,
          logoUrl: null,
          logoSvgInline: null,
          logoBackground: null,
        }}
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('FC')).toBeInTheDocument();
  });
});

describe('sizing', () => {
  it('the phone mark never drops below the 28px floor the header needs', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/logo.png' });
    const { container } = render(<BrandMark size="sm" />);
    // h-9 = 36px, with a min-width so a flex parent cannot collapse it to 0
    // (the 2026-05-26 "no logo, no fallback, just blank space" bug).
    const chip = container.firstElementChild!;
    expect(chip.className).toMatch(/\bh-9\b/);
    expect(chip.className).toMatch(/min-w-\[36px\]/);
    expect(chip.className).toMatch(/flex-shrink-0/);
  });

  it('the sidebar mark keeps its h-14 chip geometry', () => {
    seedBranding({ displayName: 'Iron Peak', logoUrl: 'https://cdn.test/logo.png' });
    const { container } = render(<BrandMark size="md" decorative />);
    const chip = container.firstElementChild!;
    expect(chip.className).toMatch(/\bh-14\b/);
    expect(chip.className).toMatch(/min-w-\[56px\]/);
    expect(chip.className).toMatch(/max-w-\[160px\]/);
    expect(chip.className).toMatch(/overflow-hidden/);
  });
});
