/**
 * Regression test for mobile bug #215 — "media picker toolbar floats over
 * the top nav, hiding Upload/Cancel."
 *
 * Root cause: AssetLibraryModal (this file's shared picker, mounted by
 * PropertiesPanel's own photo-library button AND by AddSidebar's Image/
 * Video tiles) never called useOverlayLock(), so the fixed mobile tab bar
 * could paint over its own footer/toolbar on a phone even though the modal
 * is z-[10001]. Sibling picker AssetPicker.tsx already had this fix
 * (2026-06-27); this modal was missed. Fixed 2026-07-01 by adding
 * useOverlayLock() + switching `fixed inset-0` to explicit longhand +
 * safe-area padding (matching AssetPicker.tsx's already-fixed pattern).
 *
 * This test renders the REAL AssetLibraryModal (not a stub) and asserts:
 *   1. It registers with the overlay-lock store while open (so the real
 *      MobileTabBar, proven elsewhere to respect this counter, hides).
 *   2. It does NOT use the banned `inset-0` shorthand (Taurus/consistency).
 *   3. Its upload button and close button are present and not aria-hidden.
 */
import { render, screen, act } from '@testing-library/react';
import { useUIStore } from '@/store/ui-store';

jest.mock('@/hooks/use-api', () => ({
  // The chrome's passkey entry (2026-09-24) reads the list; none here.
  usePasskeys: () => ({ data: undefined }),
  useAssets: () => ({ data: [], isLoading: false }),
  usePlaylists: () => ({ data: [], isLoading: false }),
  useTemplates: () => ({ data: [], isLoading: false }),
  useTemplateBackdrops: () => ({ data: [], isLoading: false }),
}));

jest.mock('@tanstack/react-query', () => {
  const actual = jest.requireActual('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
  };
});

import { AssetLibraryModal } from '../PropertiesPanel';

function seedCleanOverlayState() {
  act(() => {
    useUIStore.setState({ overlayOpenCount: 0 });
  });
}

describe('AssetLibraryModal (mobile bug #215)', () => {
  beforeEach(() => {
    seedCleanOverlayState();
  });

  it('registers an overlay-lock while open, so the mobile tab bar hides underneath it', () => {
    expect(useUIStore.getState().overlayOpenCount).toBe(0);
    const { unmount } = render(
      <AssetLibraryModal kind="image" onPick={jest.fn()} onClose={jest.fn()} />,
    );
    expect(useUIStore.getState().overlayOpenCount).toBe(1);
    unmount();
    expect(useUIStore.getState().overlayOpenCount).toBe(0);
  });

  it('renders the Upload and Close controls (the exact controls bug #215 hid)', () => {
    render(<AssetLibraryModal kind="image" onPick={jest.fn()} onClose={jest.fn()} />);
    expect(
      screen.getByRole('button', { name: /upload image from your computer/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('does not use the banned `inset-0` shorthand on its overlay (longhand top/right/bottom/left instead)', () => {
    const { container } = render(
      <AssetLibraryModal kind="image" onPick={jest.fn()} onClose={jest.fn()} />,
    );
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.className).not.toMatch(/\binset-0\b/);
    expect(dialog!.className).toMatch(/\btop-0\b/);
    expect(dialog!.className).toMatch(/\bright-0\b/);
    expect(dialog!.className).toMatch(/\bbottom-0\b/);
    expect(dialog!.className).toMatch(/\bleft-0\b/);
  });

  it('applies safe-area padding so the footer clears the notch / home indicator', () => {
    const { container } = render(
      <AssetLibraryModal kind="image" onPick={jest.fn()} onClose={jest.fn()} />,
    );
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.style.paddingTop).toContain('safe-area-inset-top');
    expect(dialog.style.paddingBottom).toContain('safe-area-inset-bottom');
  });
});
