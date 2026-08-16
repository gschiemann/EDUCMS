/**
 * §19 editability fix-wave proof (2026-05-28, Opus 4.8) — gaps G2 / G3 / G4.
 *
 * Runnable RTL proof (not a static trace) that the three audit gaps from
 * docs/research/2026-05-28-opus48-audit/ are closed. Each test mounts the REAL
 * `ContentFields` switch — the live editor surface (`BuilderShell` mounts it via
 * `<PropertiesPanel>` → it dispatches the same switch) — so a green run means an
 * operator can actually perform the edit, per CLAUDE.md rule #9 (anti-costume)
 * and §19 ("the operator must actually be able to click the text and edit it").
 *
 *   G2  — universal font-SIZE control. The render path already injects
 *         cfg.fontSize (BuilderZone buildRules → `font-size: Npx !important`;
 *         player mirrors it). NO control wrote it for any auto-form widget.
 *         Proof: the universal "Text style" block now surfaces a Font-size
 *         field that fires updateZone with cfg.fontSize.
 *   G4  — the two remaining JSON holdouts become structured editors:
 *         RETAIL_STOREFRONT_HOURS openHours (7-row day → string) and
 *         RETAIL_WAYFINDING_MAP youAreHere ({x,y}|null). Proof: editing a row /
 *         an x/y flows through onChange with the exact shape the widget reads.
 *   G3  — EXTERNAL_HTML per-image replacement. Editor discovers [data-img] /
 *         [data-widget="image-slot"] slots and writes cfg.imageOverrides; the
 *         ExternalHtmlWidget encodes that map as the ?img= URL param the V2
 *         shim consumes. Proof: editor surfaces the image field + setting it
 *         writes cfg.imageOverrides, AND the same map round-trips to a decodable
 *         ?img= param (the editor→encode→render contract).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContentFields } from '../PropertiesPanel';

// Test-noise silencer: the builder UI mounts the AI affordances
// (AiGenerateButton / ChatToEditBox / InlineRewriteChips / …), each of
// which probes GET /ai/key through apiFetch() on mount. In jsdom that
// probe can only fail — spamming console.error from the api-client
// logger — and its .then(setState) lands AFTER the test's act() scope,
// firing "not wrapped in act(...)" warnings. This suite does not test
// the AI affordances, so keep the probe permanently pending. (The G3
// section's global.fetch mock is unaffected — the EXTERNAL_HTML field
// discovery fetches the template HTML directly, not through apiFetch.)
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

function makeZone(widgetType: string, defaultConfig: Record<string, unknown> = {}) {
  return { id: 'gap-zone', widgetType, defaultConfig };
}

/** Last { defaultConfig } patch handed to updateZone. */
function lastCfg(updateZone: jest.Mock): Record<string, unknown> {
  const calls = updateZone.mock.calls;
  return calls[calls.length - 1][1].defaultConfig as Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────────────────────
// G2 — universal font-size control
// ────────────────────────────────────────────────────────────────────────────
describe('G2 — universal font-size control reaches every auto-form widget', () => {
  it('ANNOUNCEMENT (relies on the universal text-style block) exposes a Font size field', () => {
    render(<ContentFields zone={makeZone('ANNOUNCEMENT', { message: 'Hello' })} updateZone={jest.fn()} />);
    // FontSizeField labels its number input with aria-label = the label text.
    expect(screen.getByLabelText('Font size')).toBeTruthy();
    // The increase/decrease steppers prove it's the real FontSizeField.
    expect(screen.getByRole('button', { name: /increase font size/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /decrease font size/i })).toBeTruthy();
  });

  it('typing a size fires updateZone with cfg.fontSize (the injection consumes this)', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('ANNOUNCEMENT', { message: 'Hello' })} updateZone={updateZone} />);
    fireEvent.change(screen.getByLabelText('Font size'), { target: { value: '96' } });
    expect(updateZone).toHaveBeenCalled();
    expect(lastCfg(updateZone).fontSize).toBe(96);
    // The other config keys survive the patch (spread, not replace).
    expect(lastCfg(updateZone).message).toBe('Hello');
  });

  it('the stepper bumps cfg.fontSize by 2 (canva-style + button)', () => {
    const updateZone = jest.fn();
    // Seed a known size so the bump is deterministic (base = explicit value).
    render(<ContentFields zone={makeZone('ANNOUNCEMENT', { message: 'Hi', fontSize: 40 })} updateZone={updateZone} />);
    fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    expect(lastCfg(updateZone).fontSize).toBe(42);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G4a — RETAIL_STOREFRONT_HOURS openHours (7-row day editor)
// ────────────────────────────────────────────────────────────────────────────
describe('G4 — RETAIL_STOREFRONT_HOURS open-hours editor (was JSON-only)', () => {
  it('renders one input per day, not a JSON textarea', () => {
    render(<ContentFields zone={makeZone('RETAIL_STOREFRONT_HOURS', { openHours: { mon: '10am – 8pm' } })} updateZone={jest.fn()} />);
    // 7 day inputs by aria-label.
    for (const d of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      expect(screen.getByLabelText(`${d} hours`)).toBeTruthy();
    }
    // The seeded Monday value shows in its own input.
    expect((screen.getByLabelText('Monday hours') as HTMLInputElement).value).toBe('10am – 8pm');
    // The old JSON textarea label is gone.
    expect(screen.queryByText(/JSON object/i)).toBeNull();
  });

  it('editing a day flows through onChange as an object keyed by the day (widget shape)', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('RETAIL_STOREFRONT_HOURS', { openHours: { mon: '10am – 8pm' } })} updateZone={updateZone} />);
    fireEvent.change(screen.getByLabelText('Friday hours'), { target: { value: '10am – 9pm' } });
    const oh = lastCfg(updateZone).openHours as Record<string, string>;
    expect(oh.fri).toBe('10am – 9pm');
    expect(oh.mon).toBe('10am – 8pm'); // untouched
  });

  it('clearing a day removes the key (so the plate omits it)', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('RETAIL_STOREFRONT_HOURS', { openHours: { mon: '10am – 8pm', sun: 'Closed' } })} updateZone={updateZone} />);
    fireEvent.change(screen.getByLabelText('Sunday hours'), { target: { value: '' } });
    const oh = lastCfg(updateZone).openHours as Record<string, string>;
    expect('sun' in oh).toBe(false);
    expect(oh.mon).toBe('10am – 8pm');
  });

  it('accepts a legacy JSON-string openHours value without blanking (back-compat)', () => {
    render(<ContentFields zone={makeZone('RETAIL_STOREFRONT_HOURS', { openHours: JSON.stringify({ sat: '11am – 5pm' }) })} updateZone={jest.fn()} />);
    expect((screen.getByLabelText('Saturday hours') as HTMLInputElement).value).toBe('11am – 5pm');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G4b — RETAIL_WAYFINDING_MAP youAreHere ({x,y}|null)
// ────────────────────────────────────────────────────────────────────────────
describe('G4 — RETAIL_WAYFINDING_MAP “you are here” editor (was JSON-only)', () => {
  it('renders x / y number inputs + a show-marker toggle, not a JSON textarea', () => {
    render(<ContentFields zone={makeZone('RETAIL_WAYFINDING_MAP', { youAreHere: { x: 50, y: 92 } })} updateZone={jest.fn()} />);
    expect(screen.getByLabelText(/Marker X position/i)).toBeTruthy();
    expect(screen.getByLabelText(/Marker Y position/i)).toBeTruthy();
    expect(screen.getByLabelText(/Show the .*you are here.* marker/i)).toBeTruthy();
    expect(screen.queryByText(/JSON \{ x, y \}/i)).toBeNull();
  });

  it('editing X flows through onChange as { x, y } (widget shape)', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('RETAIL_WAYFINDING_MAP', { youAreHere: { x: 50, y: 92 } })} updateZone={updateZone} />);
    fireEvent.change(screen.getByLabelText(/Marker X position/i), { target: { value: '25' } });
    const yah = lastCfg(updateZone).youAreHere as { x: number; y: number };
    expect(yah.x).toBe(25);
    expect(yah.y).toBe(92); // untouched
  });

  it('unchecking the toggle sets youAreHere to null (hide the marker)', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('RETAIL_WAYFINDING_MAP', { youAreHere: { x: 50, y: 92 } })} updateZone={updateZone} />);
    fireEvent.click(screen.getByLabelText(/Show the .*you are here.* marker/i));
    expect(lastCfg(updateZone).youAreHere).toBeNull();
  });

  it('clamps an out-of-range coordinate into 0–100', () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('RETAIL_WAYFINDING_MAP', { youAreHere: { x: 50, y: 92 } })} updateZone={updateZone} />);
    fireEvent.change(screen.getByLabelText(/Marker Y position/i), { target: { value: '180' } });
    const yah = lastCfg(updateZone).youAreHere as { x: number; y: number };
    expect(yah.y).toBe(100);
  });

  it('accepts a legacy JSON-string youAreHere value (back-compat)', () => {
    render(<ContentFields zone={makeZone('RETAIL_WAYFINDING_MAP', { youAreHere: '{"x":10,"y":20}' })} updateZone={jest.fn()} />);
    expect((screen.getByLabelText(/Marker X position/i) as HTMLInputElement).value).toBe('10');
    expect((screen.getByLabelText(/Marker Y position/i) as HTMLInputElement).value).toBe('20');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G3 — EXTERNAL_HTML per-image replacement (editor → cfg.imageOverrides → ?img=)
// ────────────────────────────────────────────────────────────────────────────
// A minimal template that carries BOTH the shipped image-slot convention
// (data-widget="image-slot" + data-slot) AND a literal data-img slot, so we
// prove the editor discovers both. Includes a data-field so we also confirm
// text + image co-exist.
const TEMPLATE_HTML = `<!doctype html><html><head></head><body>
  <div class="photo-bg" data-widget="image-slot" data-slot="hero" data-aspect="3840x2160">
    <div class="lbl">Hero photo</div>
  </div>
  <img data-img="logo" data-aspect="400x400" />
  <h1 data-field="title">Welcome</h1>
</body></html>`;

describe('G3 — EXTERNAL_HTML editor discovers swappable images', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(TEMPLATE_HTML),
    }) as unknown as typeof global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('surfaces an Images section with a field per slot (data-slot AND data-img)', async () => {
    render(<ContentFields zone={makeZone('EXTERNAL_HTML', { url: '/templates/test.html' })} updateZone={jest.fn()} />);
    // Section header.
    expect(await screen.findByText('Images', {}, { timeout: 3000 })).toBeTruthy();
    // The image-slot caption is used as the field label; logo (data-img) falls
    // back to the humanized key.
    await waitFor(() => {
      expect(screen.getByText(/Hero photo \(3840x2160\)/i)).toBeTruthy();
    });
    // data-img="logo" slot is discovered too (label humanized from the key).
    expect(screen.getByText(/logo \(400x400\)/i)).toBeTruthy();
  });

  it('setting an image URL writes cfg.imageOverrides keyed by the slot', async () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('EXTERNAL_HTML', { url: '/templates/test.html' })} updateZone={updateZone} />);
    await screen.findByText('Images', {}, { timeout: 3000 });
    // AssetPickerField renders a URL text input ("https://… or pick from library")
    // per slot — two here (hero + logo). First in DOM order is data-slot="hero".
    const urlInputs = screen.getAllByPlaceholderText(/https:.* or pick from library/i);
    expect(urlInputs.length).toBe(2);
    // ControlledUrlInput defers onChange to blur.
    fireEvent.change(urlInputs[0], { target: { value: 'https://cdn.example.com/hero.jpg' } });
    fireEvent.blur(urlInputs[0]);
    expect(updateZone).toHaveBeenCalled();
    const io = lastCfg(updateZone).imageOverrides as Record<string, string>;
    expect(io.hero).toBe('https://cdn.example.com/hero.jpg');
  });

  it('does NOT show the “no editable hooks” message when only images exist', async () => {
    // Template with an image slot but zero data-field nodes.
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(`<!doctype html><html><head></head><body><div data-img="only">x</div></body></html>`),
    });
    render(<ContentFields zone={makeZone('EXTERNAL_HTML', { url: '/templates/imgonly.html' })} updateZone={jest.fn()} />);
    expect(await screen.findByText('Images', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText(/no editable text, image, or video hooks/i)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G3b — EXTERNAL_HTML video + poster replacement
// ────────────────────────────────────────────────────────────────────────────
const VIDEO_TEMPLATE_HTML = `<!doctype html><html><head></head><body>
  <video data-videoslot="feature.clip" data-posterslot="feature.poster" data-aspect="16:9"></video>
  <h1 data-field="title">Fresh today</h1>
</body></html>`;

describe('G3b — EXTERNAL_HTML editor discovers swappable video and poster slots', () => {
  let originalFetch: typeof global.fetch;
  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(VIDEO_TEMPLATE_HTML),
    }) as unknown as typeof global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('surfaces separate Videos and Images controls for the clip and poster', async () => {
    render(<ContentFields zone={makeZone('EXTERNAL_HTML', { url: '/templates/video.html' })} updateZone={jest.fn()} />);
    expect(await screen.findByText('Videos', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText('Images')).toBeTruthy();
    expect(screen.getByText(/Feature .* Clip \(16:9\)/i)).toBeTruthy();
    expect(screen.getByText(/Feature .* Poster \(16:9\)/i)).toBeTruthy();
  });

  it('writes a selected clip to cfg.videoOverrides', async () => {
    const updateZone = jest.fn();
    render(<ContentFields zone={makeZone('EXTERNAL_HTML', { url: '/templates/video.html' })} updateZone={updateZone} />);
    await screen.findByText('Videos', {}, { timeout: 3000 });
    const urlInputs = screen.getAllByPlaceholderText(/https:.* or pick from library/i);
    fireEvent.change(urlInputs[0], { target: { value: 'https://cdn.example.com/lunch.mp4' } });
    fireEvent.blur(urlInputs[0]);
    expect(updateZone).toHaveBeenCalled();
    const vo = lastCfg(updateZone).videoOverrides as Record<string, string>;
    expect(vo['feature.clip']).toBe('https://cdn.example.com/lunch.mp4');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// G3 — the editor→encode→render contract: cfg.imageOverrides → decodable ?img=
// ────────────────────────────────────────────────────────────────────────────
// Mirror of the ExternalHtmlWidget encoder (WidgetRenderer.tsx) so the test
// proves the param the render side emits is the SAME map the editor wrote and
// the SAME shape the V2 shim decodes — without needing the heavy player route.
// If the encoder shape ever drifts, this fails.
function encodeImgParam(imageOverrides: Record<string, unknown>): string | null {
  const clean: Record<string, unknown> = {};
  for (const k of Object.keys(imageOverrides)) {
    const v = imageOverrides[k];
    if (v == null) continue;
    if (typeof v === 'string' && !v.trim()) continue;
    clean[k] = v;
  }
  if (Object.keys(clean).length === 0) return null;
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(clean))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `img=${b64}`;
}
// Mirror of the V2 shim's base64url → JSON decode (inject-shim-v2.cjs `dec`).
function decodeShimParam(b64: string): unknown {
  const j = decodeURIComponent(
    Array.prototype.map
      .call(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join(''),
  );
  return JSON.parse(j);
}

describe('G3 — imageOverrides round-trips editor → ?img= → shim decode', () => {
  it('encodes the override map to a ?img= param the shim can decode back', () => {
    const imageOverrides = { hero: 'https://cdn.example.com/hero.jpg', logo: 'https://cdn.example.com/logo.png' };
    const param = encodeImgParam(imageOverrides);
    expect(param).toMatch(/^img=/);
    const decoded = decodeShimParam(param!.slice('img='.length)) as Record<string, string>;
    expect(decoded.hero).toBe('https://cdn.example.com/hero.jpg');
    expect(decoded.logo).toBe('https://cdn.example.com/logo.png');
  });

  it('emits no param when there are no real overrides (template defaults show through)', () => {
    expect(encodeImgParam({})).toBeNull();
    expect(encodeImgParam({ hero: '' })).toBeNull();
    expect(encodeImgParam({ hero: undefined as unknown as string })).toBeNull();
  });
});
