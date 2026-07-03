/**
 * E3 (CRUSH Wave E, 2026-07-03) — "Put on a screen" from inside the editor.
 *
 * Proof (per CLAUDE.md §21/§19 — a runnable proof, not a static trace) that
 * the SaveStatusChip morphs into the express-lane CTA described in
 * docs/research/2026-07-01-launch-sprint/05-EDITOR-CRUSH-LENSES.md:353
 * ("Saved ✓ — Put on a screen →"), reusing the exact putOnScreen handler
 * lifted from the gallery (apps/web/src/lib/put-on-screen.ts). Mounts the
 * REAL BuilderToolbar against the real useBuilderStore (no mocking the
 * store — it's the same Zustand singleton BuilderShell drives).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { BuilderToolbar } from '../BuilderToolbar';
import { useBuilderStore } from '../useBuilderStore';

function resetStore(overrides: Partial<ReturnType<typeof useBuilderStore.getState>> = {}) {
  useBuilderStore.setState({
    templateId: 'tpl-1',
    isSystem: false,
    zones: [],
    meta: {
      name: 'Cafeteria Menu',
      description: '',
      screenWidth: 1920,
      screenHeight: 1080,
      bgColor: '',
      bgGradient: '',
      bgImage: '',
      dataSource: 'NONE',
    },
    isDirty: false,
    ...overrides,
  } as any);
}

const noop = () => {};

describe('E3 — SaveStatusChip morphs into "Put on a screen" CTA', () => {
  beforeEach(() => resetStore());

  it('a just-saved (status="saved"), non-system template shows the express-lane CTA', () => {
    const onPutOnScreen = jest.fn();
    render(
      <BuilderToolbar
        onBack={noop}
        onSave={noop}
        saveStatus="saved"
        lastSavedAt={Date.now()}
        onPutOnScreen={onPutOnScreen}
      />,
    );
    const cta = screen.getByRole('button', { name: /put on a screen/i });
    expect(cta).toBeTruthy();
    fireEvent.click(cta);
    expect(onPutOnScreen).toHaveBeenCalledTimes(1);
  });

  it('a previously-saved, clean template (status="idle", lastSavedAt set) ALSO shows the CTA — not just the 2.5s flash window', () => {
    const onPutOnScreen = jest.fn();
    render(
      <BuilderToolbar
        onBack={noop}
        onSave={noop}
        saveStatus="idle"
        lastSavedAt={Date.now() - 60_000}
        onPutOnScreen={onPutOnScreen}
      />,
    );
    expect(screen.getByRole('button', { name: /put on a screen/i })).toBeTruthy();
  });

  it('a DIRTY template (unsaved edits) does NOT show the CTA — publishing must reflect what is actually saved', () => {
    resetStore({ isDirty: true });
    const onPutOnScreen = jest.fn();
    render(
      <BuilderToolbar
        onBack={noop}
        onSave={noop}
        saveStatus="idle"
        lastSavedAt={Date.now() - 60_000}
        onPutOnScreen={onPutOnScreen}
      />,
    );
    expect(screen.queryByRole('button', { name: /put on a screen/i })).toBeNull();
    expect(screen.getByText('Unsaved')).toBeTruthy();
  });

  it('a system/starter template hides the CTA even when saveStatus="saved" (BuilderToolbar gates it — nothing of the operator\'s is persisted yet)', () => {
    resetStore({ isSystem: true });
    const onPutOnScreen = jest.fn();
    render(
      <BuilderToolbar
        onBack={noop}
        onSave={noop}
        saveStatus="saved"
        lastSavedAt={Date.now()}
        onPutOnScreen={onPutOnScreen}
      />,
    );
    expect(screen.queryByRole('button', { name: /put on a screen/i })).toBeNull();
  });

  it('while a publish is in flight (puttingOnScreenBusy), the CTA is disabled so a double-click cannot create two playlists', () => {
    const onPutOnScreen = jest.fn();
    render(
      <BuilderToolbar
        onBack={noop}
        onSave={noop}
        saveStatus="saved"
        lastSavedAt={Date.now()}
        onPutOnScreen={onPutOnScreen}
        puttingOnScreenBusy
      />,
    );
    const cta = screen.getByRole('button', { name: /put on a screen/i }) as HTMLButtonElement;
    expect(cta.disabled).toBe(true);
  });

  it('when onPutOnScreen is not supplied at all, the plain "Saved" chip renders (back-compat — no crash, no dangling CTA)', () => {
    render(
      <BuilderToolbar
        onBack={noop}
        onSave={noop}
        saveStatus="saved"
        lastSavedAt={Date.now()}
      />,
    );
    expect(screen.queryByRole('button', { name: /put on a screen/i })).toBeNull();
    expect(screen.getByText('Saved')).toBeTruthy();
  });
});
