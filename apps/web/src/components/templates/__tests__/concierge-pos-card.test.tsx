/**
 * The Concierge's POS card, end to end inside SignageConcierge (2026-09-22).
 *
 * Greg: "our AI needs to be super tuned into our POS integrations so that when
 * we ask for an integration it knows to ask what one and ensures the template is
 * created with perfect integrations into those systems".
 *
 * The POS contexts are producer-cut (concierge-pos-context.fixture.ts — printed
 * by the API's own loadConciergePosContext). The chat double answers like the
 * real /templates/concierge/chat does once the operator asks for a menu board.
 */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { POS_CONTEXT_NONE, POS_CONTEXT_TOAST } from './concierge-pos-context.fixture';

let posContext: any = POS_CONTEXT_TOAST;
let turnIntake: any = { purpose: 'menu', widgets: ['headline', 'menu'] };
let urlReferenceResult: any = { kind: 'url', label: 'taqueria.example', summary: 'Brand: Example Taqueria.' };
const chatCalls: any[] = [];
const posQueryEnabled: boolean[] = [];
const oauthOpened: string[] = [];

jest.mock('@/hooks/use-api', () => ({
  useConciergeChat: () => ({
    mutateAsync: jest.fn(async (body: any) => {
      chatCalls.push(body);
      return { reply: 'Great — let\'s pick the look.', intake: turnIntake, missing: [], ready: false, brief: 'A menu board.' };
    }),
    isPending: false,
  }),
  useConciergeUrlReference: () => ({ mutateAsync: jest.fn(async () => urlReferenceResult), isPending: false }),
  useConciergeImageReference: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

jest.mock('@/hooks/use-concierge-pos', () => ({
  useConciergePosContext: (enabled: boolean) => {
    posQueryEnabled.push(enabled);
    return { data: enabled ? posContext : undefined };
  },
  openPosOAuthInNewTab: jest.fn(async (id: string) => { oauthOpened.push(id); return true; }),
}));

jest.mock('next/navigation', () => ({ useParams: () => ({ schoolId: 'super-taco' }) }));

import { SignageConcierge } from '../SignageConcierge';

const onGenerate = jest.fn();

function renderConcierge(over: { posEnabled?: boolean } = {}) {
  return render(
    <SignageConcierge
      vertical="restaurant"
      canvas={{ w: 1920, h: 1080 }}
      interactive={false}
      onGenerate={onGenerate}
      generating={false}
      posEnabled={over.posEnabled ?? true}
    />,
  );
}

async function say(text: string) {
  fireEvent.change(screen.getByPlaceholderText(/Type your reply/), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  });
}

beforeEach(() => {
  posContext = POS_CONTEXT_TOAST;
  turnIntake = { purpose: 'menu', widgets: ['headline', 'menu'] };
  urlReferenceResult = { kind: 'url', label: 'taqueria.example', summary: 'Brand: Example Taqueria.' };
  chatCalls.length = 0;
  posQueryEnabled.length = 0;
  oauthOpened.length = 0;
  onGenerate.mockReset();
});

describe('connected POS — "Use your Toast menu?"', () => {
  it('offers the menu with sections pre-ticked, the row limit held, and an honest live note', async () => {
    renderConcierge();
    await say('a menu board for the counter');
    const card = await screen.findByTestId('concierge-pos-card');
    expect(card).toHaveTextContent('Use your Toast menu — 47 items in 3 categories?');
    expect(card).toHaveTextContent('Tick what this screen shows — up to 24 items fit.');
    expect(screen.getByRole('checkbox', { name: /Tacos/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Burritos/ })).toBeChecked();
    // Drinks (26) cannot fit one 1080p screen — it cannot even be ticked.
    expect(screen.getByRole('checkbox', { name: /Drinks/ })).toBeDisabled();
    expect(card).toHaveTextContent('21 of up to 24 items');
    expect(card).toHaveTextContent("Names and prices stay in sync with Toast. Toast doesn't report sold-out items, so those won't update on their own.");
  });

  it('"Use 21 items" sends the pick with the chat turn, and Generate carries it', async () => {
    renderConcierge();
    await say('a menu board for the counter');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Use 21 items' }));
    });
    const last = chatCalls[chatCalls.length - 1];
    expect(last.posSelection).toEqual({ connectionId: 'conn-chain-toast', sections: ['Tacos', 'Burritos'] });
    expect(last.messages[last.messages.length - 1]).toEqual({ role: 'user', content: 'Use my Toast menu: Tacos, Burritos.' });
    expect(screen.getByTestId('concierge-pos-card')).toHaveTextContent('Using your Toast menu · 21 items');

    // Every later turn carries it too.
    await say('bold and warm');
    expect(chatCalls[chatCalls.length - 1].posSelection).toEqual({ connectionId: 'conn-chain-toast', sections: ['Tacos', 'Burritos'] });

    fireEvent.click(screen.getByRole('button', { name: /Generate 3 boards/ }));
    await waitFor(() => expect(onGenerate).toHaveBeenCalled());
    expect(onGenerate.mock.calls[0][0].posSelection).toEqual({ connectionId: 'conn-chain-toast', sections: ['Tacos', 'Burritos'] });
  });

  it('unticking a section changes the pick; "Change" reopens the card', async () => {
    renderConcierge();
    await say('a menu board for the counter');
    fireEvent.click(await screen.findByRole('checkbox', { name: /Burritos/ }));
    expect(screen.getByTestId('concierge-pos-card')).toHaveTextContent('13 of up to 24 items');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Use 13 items' }));
    });
    expect(chatCalls[chatCalls.length - 1].posSelection.sections).toEqual(['Tacos']);
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(await screen.findByRole('button', { name: /^Use \d+ items$/ })).toBeInTheDocument();
  });

  it('"Type my menu instead" tells the Concierge and never sends a pick', async () => {
    renderConcierge();
    await say('a menu board for the counter');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Type my menu instead' }));
    });
    const last = chatCalls[chatCalls.length - 1];
    expect(last.messages[last.messages.length - 1].content).toBe("I don't use a POS — I'll type my menu.");
    expect(last).not.toHaveProperty('posSelection');
    expect(screen.getByTestId('concierge-pos-card')).toHaveTextContent('Got it — type or paste your menu in the chat.');
  });
});

describe('no POS connected — "Which POS do you use?"', () => {
  beforeEach(() => { posContext = POS_CONTEXT_NONE; });

  it('asks which POS, the one their website links to FIRST and highlighted', async () => {
    urlReferenceResult = { kind: 'url', label: 'taqueria.example', summary: 'Brand: Example Taqueria.', detectedPos: [{ providerId: 'toast', name: 'Toast', confidence: 0.7 }] };
    renderConcierge();
    fireEvent.click(screen.getByRole('button', { name: /Add a website/i }));
    fireEvent.change(await screen.findByPlaceholderText('https://your-business.com'), { target: { value: 'taqueria.example' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });
    const card = await screen.findByTestId('concierge-pos-card');
    expect(card).toHaveTextContent('Your website links to Toast — connect it?');
    const providers = Array.from(card.querySelectorAll('[data-provider]')).map((el) => el.getAttribute('data-provider'));
    expect(providers[0]).toBe('toast');
    // Toast connects in Settings → POS (Codex's automatic setup), in a NEW tab — the chat survives.
    const toast = card.querySelector('[data-provider="toast"]') as HTMLAnchorElement;
    expect(toast.getAttribute('href')).toBe('/super-taco/settings/pos');
    expect(toast.getAttribute('target')).toBe('_blank');
    expect(toast).toHaveTextContent('On your site');
  });

  it('an OAuth POS opens its sign-in in a new tab from the card', async () => {
    renderConcierge();
    await say('a menu board for the counter');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Square/ }));
    });
    expect(oauthOpened).toEqual(['square']);
  });

  it('"I don\'t use a POS" tells the Concierge and folds the card away', async () => {
    renderConcierge();
    await say('a menu board for the counter');
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: "I don't use a POS" }));
    });
    expect(chatCalls[chatCalls.length - 1].messages.slice(-1)[0].content).toBe("I don't use a POS — I'll type my menu.");
    expect(screen.getByTestId('concierge-pos-card')).toHaveTextContent('Use a POS instead');
  });
});

describe('when the card stays out of the way', () => {
  it('a non-menu board never shows it — and never even asks for the POS context', async () => {
    turnIntake = { purpose: 'welcome', widgets: ['headline'] };
    renderConcierge();
    await say('a welcome board for our lobby');
    expect(screen.queryByTestId('concierge-pos-card')).not.toBeInTheDocument();
    expect(posQueryEnabled.every((e) => e === false)).toBe(true);
  });

  it('without posEnabled the Concierge is exactly as before', async () => {
    renderConcierge({ posEnabled: false });
    await say('a menu board for the counter');
    expect(screen.queryByTestId('concierge-pos-card')).not.toBeInTheDocument();
    expect(posQueryEnabled).toEqual([]);
    expect(chatCalls[chatCalls.length - 1]).not.toHaveProperty('posSelection');
  });
});
