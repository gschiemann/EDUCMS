/**
 * Settings → Emergency content cards (2026-10-12, owner: "each card has a
 * different background colour and border — messy"). Every alert type renders
 * the SAME neutral card; only the small dot carries the type's colour.
 */
import * as React from 'react';
import { render } from '@testing-library/react';
import { PanicContentEditor } from '../PanicContentEditor';

jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock('@/store/ui-store', () => ({ useUIStore: { getState: () => ({ token: null }) } }));
jest.mock('@/components/ui/app-dialog', () => ({ appConfirm: jest.fn() }));
jest.mock('@/lib/upload-accept', () => ({
  ALERT_CONTENT_ACCEPT: 'image/*',
  uploadProblemFor: () => null,
  useUploadProblemText: () => () => '',
}));
jest.mock('@/hooks/use-api', () => ({
  usePanicContent: () => ({ data: { items: [] }, isLoading: false }),
  useAddPanicAsset: () => ({ mutate: jest.fn() }),
  useRemovePanicAsset: () => ({ mutate: jest.fn() }),
}));

const TYPES = [
  ['lockdown', 'red'], ['evacuate', 'orange'], ['medical', 'rose'],
  ['secure', 'amber'], ['weather', 'violet'], ['hold', 'sky'],
] as const;

it.each(['live', 'drill'] as const)('every %s card shares one neutral style; only the dot is coloured', (mode) => {
  const { container } = render(
    <>
      {TYPES.map(([kind, accent]) => (
        <PanicContentEditor key={kind} kind={kind as any} mode={mode} accent={accent} label={kind} />
      ))}
    </>,
  );
  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-alert-content-card]'));
  expect(cards).toHaveLength(6);
  const styles = new Set(cards.map((c) => c.className));
  expect(styles.size).toBe(1);
  const [style] = Array.from(styles);
  expect(style).toContain('bg-white');
  expect(style).not.toMatch(/(red|orange|rose|amber|violet|sky|indigo|blue)-/);
  // The type colour survives as the dot alone.
  expect(cards[0].querySelector('.bg-red-500')).not.toBeNull();
  expect(cards[5].querySelector('.bg-sky-500')).not.toBeNull();
});
