/**
 * A photo declared as a plain `data-field` gets a PICKER, not a text box.
 *
 * Operator, 2026-08-25: *"when i select the image background of this template
 * it takes me to a free text field and not a new background picker option."*
 * They were editing the packaged fitness Soundfloor board — section PROGRAM,
 * field "Program · Image" — and got an empty single-line input where the photo
 * belongs.
 *
 * The rule under test needs BOTH signals to agree (see `isImageishField`):
 * the key's LEAF names a picture, AND the current value is empty or reads as
 * an image reference. Either signal alone regresses: 110 of the 178 image-ish
 * keys across the shipped boards are `hero.eyebrow` / `hero.deck` / `hero.lede`
 * where "hero" is the section, and 27 are `theme.bg` holding a hex colour. Two
 * of these tests exist purely to hold that line.
 */
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

// Same posture as the other builder suites: the AI affordances probe
// GET /ai/key on mount and can only fail in jsdom. Keep it pending.
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

function makeZone(cfg: Record<string, unknown> = {}) {
  return { id: 'img-field-zone', widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/test.html', ...cfg } };
}
function lastCfg(updateZone: jest.Mock): Record<string, unknown> {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig as Record<string, unknown>;
}
const URL_INPUT = /https:.* or pick from library/i;

let originalFetch: typeof global.fetch;
function serveHtml(html: string) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(html) }) as unknown as typeof global.fetch;
}
beforeEach(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; jest.restoreAllMocks(); });

// ────────────────────────────────────────────────────────────────────────
// The bug the operator reported
// ────────────────────────────────────────────────────────────────────────
describe('an image-ish data-field renders a picker', () => {
  it('a `program.image` photo panel gets an asset picker, not a text box', async () => {
    serveHtml(`<!doctype html><html><body>
      <div class="photo" data-field="program.image"></div>
      <div class="eyebrow" data-field="program.category">CARDIO FLOOR FEATURE</div>
    </body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);

    // The label the operator already knows survives verbatim.
    expect(await screen.findByText('Program · Image', {}, { timeout: 3000 })).toBeTruthy();
    // One picker — for the photo. The neighbouring copy field stays text.
    await waitFor(() => expect(screen.getAllByPlaceholderText(URL_INPUT)).toHaveLength(1));
    expect(screen.getByText('Browse library')).toBeTruthy();
    // …and the picker replaced the text box: no styleable input for that key.
    const photoRow = document.querySelector('[data-edit-field="program.image"]') as HTMLElement;
    expect(photoRow).toBeTruthy();
    expect(photoRow.querySelector('textarea')).toBeNull();
  });

  it('picking an asset writes textOverrides[key] — the transport the board already reads', async () => {
    serveHtml(`<!doctype html><html><body>
      <span data-field="hero.photo_url" data-photo-for="hero.photo"></span>
    </body></html>`);
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone()} updateZone={updateZone} />);
    const input = await screen.findByPlaceholderText(URL_INPUT, {}, { timeout: 3000 });

    // ControlledUrlInput defers onChange to blur.
    fireEvent.change(input, { target: { value: 'https://cdn.example.com/lobby.jpg' } });
    fireEvent.blur(input);

    expect(updateZone).toHaveBeenCalled();
    const overrides = lastCfg(updateZone).textOverrides as Record<string, string>;
    expect(overrides['hero.photo_url']).toBe('https://cdn.example.com/lobby.jpg');
    // It must NOT quietly move to a different map the board does not read.
    expect(lastCfg(updateZone).imageOverrides).toBeUndefined();
  });

  it('an existing image URL keeps the picker (and shows the URL back)', async () => {
    serveHtml(`<!doctype html><html><body>
      <div data-field="promo.background">/templates/assets/promo-v2.png</div>
    </body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);
    const input = await screen.findByPlaceholderText(URL_INPUT, {}, { timeout: 3000 });
    expect((input as HTMLInputElement).value).toBe('/templates/assets/promo-v2.png');
  });
});

// ────────────────────────────────────────────────────────────────────────
// The false positives that would have been a much worse bug
// ────────────────────────────────────────────────────────────────────────
describe('a field whose VALUE is not an image stays a text box', () => {
  it('a "background" key holding prose is still editable as words', async () => {
    serveHtml(`<!doctype html><html><body>
      <p data-field="story.background">Founded in 1974 by two teachers and a borrowed van.</p>
    </body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);
    expect(await screen.findByDisplayValue(/Founded in 1974/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByPlaceholderText(URL_INPUT)).toBeNull();
    expect(screen.queryByText('Browse library')).toBeNull();
  });

  it('`theme.bg` holding a hex colour is still a text box (27 boards ship this)', async () => {
    serveHtml(`<!doctype html><html><body><span data-field="theme.bg">#0a0806</span></body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);
    expect(await screen.findByDisplayValue('#0a0806', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByPlaceholderText(URL_INPUT)).toBeNull();
  });

  it('`program.posterUrl` holding a caption is still a text box', async () => {
    // Shipped on the motion-studio boards: a URL-shaped key, a label value.
    serveHtml(`<!doctype html><html><body><div data-field="program.posterUrl">MOBILITY / 042</div></body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);
    expect(await screen.findByDisplayValue('MOBILITY / 042', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByPlaceholderText(URL_INPUT)).toBeNull();
  });

  it('`hero.*` copy is untouched — "hero" names the section, not a photo', async () => {
    serveHtml(`<!doctype html><html><body>
      <div data-field="hero.eyebrow">THIS WEEK</div>
      <div data-field="hero.deck">Doors at six, first serve at seven.</div>
    </body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);
    expect(await screen.findByDisplayValue('THIS WEEK', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByDisplayValue(/Doors at six/)).toBeTruthy();
    expect(screen.queryByPlaceholderText(URL_INPUT)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────
// One photo, one control
// ────────────────────────────────────────────────────────────────────────
describe('a real image slot is edited once', () => {
  it('an element marked BOTH data-field and image-slot shows only the Images picker', async () => {
    // 14 shipped boards do exactly this — the operator used to get a working
    // picker under Images AND a dead text box for the same photo below it.
    serveHtml(`<!doctype html><html><body>
      <div data-widget="image-slot" data-slot="hero.photo_url" data-aspect="1200x1300" data-field="hero.photo_url"></div>
      <h1 data-field="hero.title">Welcome</h1>
    </body></html>`);
    render(<ContentFields zone={makeZone()} updateZone={jest.fn()} />);

    expect(await screen.findByText('Images', {}, { timeout: 3000 })).toBeTruthy();
    // Exactly one control for the photo…
    await waitFor(() => expect(screen.getAllByPlaceholderText(URL_INPUT)).toHaveLength(1));
    // …and it lives in the image lane, not the text lane.
    expect(document.querySelector('[data-edit-img="hero.photo_url"]')).toBeTruthy();
    expect(document.querySelector('[data-edit-field="hero.photo_url"]')).toBeNull();
    // The board's real copy is unaffected.
    expect(screen.getByDisplayValue('Welcome')).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────────────────────
// The operator's actual board, read off disk
// ────────────────────────────────────────────────────────────────────────
describe('the shipped fitness Soundfloor board', () => {
  const board = path.join(__dirname, '../../../../public/templates/fitness/gym-media-soundfloor.html');

  it('exposes its photo panel as a picker labelled "Program · Image"', async () => {
    serveHtml(fs.readFileSync(board, 'utf8'));
    // A gym-media board also mounts MediaSourcePicker, which is a React Query
    // consumer — give it a client rather than skipping the real board.
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContentFields zone={makeZone({ url: '/templates/fitness/gym-media-soundfloor.html' })} updateZone={jest.fn()} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Program · Image', {}, { timeout: 5000 })).toBeTruthy();
    // The photo is an image slot, so it is edited in the image lane — and it
    // is NOT ALSO offered as a text row for the same key.
    expect(document.querySelector('[data-edit-img="program.image"]')).toBeTruthy();
    expect(document.querySelector('[data-edit-field="program.image"]')).toBeNull();
  });

  it('still marks the photo with a slot hook the in-board shim can paint', () => {
    // applyImages() in the baked V12 shim resolves data-imgslot → data-img →
    // data-slot. A photo left on `data-field` alone would have had the picked
    // URL written into the div as TEXT, painted across the artwork.
    const html = fs.readFileSync(board, 'utf8');
    expect(html).toContain('data-imgslot="program.image"');
    expect(html).not.toContain('data-field="program.image"');
  });
});
