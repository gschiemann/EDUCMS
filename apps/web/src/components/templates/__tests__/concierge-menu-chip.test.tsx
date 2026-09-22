/**
 * "Menu · 9 items" on the reference chip (2026-09-22).
 *
 * When the pasted site carries a real menu, the operator has no way to know we
 * read it until the boards come back — which is exactly the trust gap that made
 * "the menu items i asked to be pulled from the website i gave it, it didnt
 * fill the boards at all" so expensive. The chip in WHAT I'VE GATHERED says it
 * up front.
 *
 * The reference fixture is producer-cut from the real
 * POST /templates/concierge/reference/url — see concierge-menu-reference.fixture.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MENU_REFERENCE } from './concierge-menu-reference.fixture';

let urlReferenceResult: any = MENU_REFERENCE;

const chatTurn = {
  reply: 'Got it — I pulled all 9 items. Bold and appetizing?',
  intake: { purpose: 'menu', widgets: ['headline', 'menu'] },
  missing: [],
  ready: false,
  brief: 'A bold menu board for Super Taco.',
};

jest.mock('@/hooks/use-api', () => ({
  useConciergeChat: () => ({ mutateAsync: jest.fn(async () => chatTurn), isPending: false }),
  useConciergeUrlReference: () => ({ mutateAsync: jest.fn(async () => urlReferenceResult), isPending: false }),
  useConciergeImageReference: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

import { SignageConcierge } from '../SignageConcierge';

function renderConcierge() {
  return render(
    <SignageConcierge
      vertical="restaurant"
      canvas={{ w: 1920, h: 1080 }}
      interactive={false}
      onGenerate={jest.fn()}
      generating={false}
    />,
  );
}

async function pasteWebsite(url: string) {
  fireEvent.click(screen.getByRole('button', { name: /Add a website/i }));
  fireEvent.change(await screen.findByPlaceholderText('https://your-business.com'), { target: { value: url } });
  // Adding a site fires BOTH the scrape and the follow-up chat turn, so the
  // click settles several async state updates — act() around it keeps the
  // assertions (and the console) clean.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
  });
}

beforeEach(() => { urlReferenceResult = MENU_REFERENCE; });

it('shows "Menu · 9 items" on the website chip in WHAT I\'VE GATHERED', async () => {
  renderConcierge();
  await pasteWebsite('supertaco.example');

  const strip = (await screen.findByText(/What I've gathered/i)).closest('div') as HTMLElement;
  expect(strip).toBeTruthy();
  await waitFor(() => expect(screen.getByText('supertaco.example')).toBeInTheDocument());
  // The count is the extractor's own tally, rendered beside the site label.
  expect(screen.getByText(/Menu · 9 items/)).toBeInTheDocument();
  expect(strip).toContainElement(screen.getByText(/Menu · 9 items/));
});

it('says nothing about a menu when the site had none', async () => {
  urlReferenceResult = { kind: 'url', label: 'joecoffee.com', summary: 'Brand: Joe Coffee.', palette: ['#6f4e37'] };
  renderConcierge();
  await pasteWebsite('joecoffee.com');

  await waitFor(() => expect(screen.getByText('joecoffee.com')).toBeInTheDocument());
  expect(screen.queryByText(/Menu · /)).not.toBeInTheDocument();
});
