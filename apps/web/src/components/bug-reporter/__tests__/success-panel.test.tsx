/**
 * What a customer reads after reporting a problem (2026-10-11): a plain
 * "we got it" with the reference — no internal tooling, no statuses, no links
 * into the owner console. Platform staff keep their console shortcut.
 */
import { render, screen } from '@testing-library/react';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import zh from '@/i18n/messages/zh.json';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
jest.mock('@/lib/store', () => ({ useAppStore: () => undefined }));
jest.mock('@/lib/bug-capture', () => ({ captureBugBundle: jest.fn() }));
jest.mock('@/lib/bug-ringbuffers', () => ({ setBugCaptureIgnoreSelector: jest.fn() }));
jest.mock('@/hooks/use-bugs', () => ({ useCreateBug: () => ({ mutateAsync: jest.fn() }) }));
jest.mock('@/hooks/use-overlay-lock', () => ({ useOverlayLock: jest.fn() }));

import { SuccessPanel } from '../BugReporterButton';

const INTERNAL = /diff|pull request|\bPR\b|\bCI\b|approve|confidence|automated|\bAI\b|proposed|\/super/i;

describe('bug report success panel', () => {
  it('says we received it, with the reference, and nothing internal', () => {
    const { container } = render(<SuccessPanel bugId="abcdef12-3456" isSuperAdmin={false} onClose={() => {}} />);
    expect(screen.getByText(/we received your report \(ref #abcdef12\) and our team is on it/i)).toBeInTheDocument();
    expect(container.textContent).toContain('support@venue-os.app');
    expect(container.textContent ?? '').not.toMatch(INTERNAL);
    expect(container.querySelector('a[href*="/super"]')).toBeNull();
  });

  it('gives platform staff the owner-console link', () => {
    const { container } = render(<SuccessPanel bugId="abcdef12-3456" isSuperAdmin onClose={() => {}} />);
    expect(container.querySelector('a[href="/super/bugs/abcdef12-3456"]')).not.toBeNull();
  });

  it('the copy exists in en, es and zh and none of it is internal vocabulary', () => {
    for (const catalog of [en, es, zh] as unknown as Array<{ bugReporter: Record<string, string> }>) {
      const b = catalog.bugReporter;
      expect(b.successBody).toContain('{ref}');
      expect(`${b.successTitle} ${b.successBody} ${b.intro}`).not.toMatch(/diff|pull request|\bCI\b|confidence|automated|\bAI\b|\bIA\b/i);
    }
  });
});
