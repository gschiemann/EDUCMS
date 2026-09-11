/**
 * PROVE THE CODE SCANS. Not "a QR-looking image rendered" — decode it.
 *
 * This is the assertion that matters and the one a screenshot cannot make. The
 * widget this replaces, `RetailLoyaltyQRWidget`, draws a decorative SVG lattice
 * that looks exactly like a QR code in the builder, on the wall, and in any
 * screenshot — and no phone can read it. A test that only checked "an image
 * appeared" would have passed on that too.
 *
 * So: render the real widget, take the data URL it produced, decode the PNG
 * (pngjs) and run a real QR decoder over the pixels (jsqr — the same library
 * the /pair screen uses to read pairing codes from a camera). The decoded text
 * must equal the payload byte for byte.
 */
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';

// jsdom does not define TextEncoder/TextDecoder, and `qrcode` needs them to
// encode a payload to bytes. Without this the widget's generation promise
// rejects with a bare ReferenceError and every assertion below would fail for a
// reason that has nothing to do with the widget. Real browsers have both.
(global as unknown as { TextEncoder?: unknown }).TextEncoder ??= NodeTextEncoder;
(global as unknown as { TextDecoder?: unknown }).TextDecoder ??= NodeTextDecoder;

import { render, screen, waitFor } from '@testing-library/react';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { QrCodeWidget } from '../QrCodeWidget';

class FakeRO { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeRO;

jest.setTimeout(30_000);

/** data:image/png;base64,… → the text a phone camera would read, or null. */
function decodeQr(dataUrl: string): string | null {
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const png = PNG.sync.read(Buffer.from(b64, 'base64'));
  const res = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return res ? res.data : null;
}

async function renderAndDecode(config: Record<string, unknown>): Promise<string | null> {
  render(
    <div style={{ position: 'relative', width: 1200, height: 800 }}>
      <QrCodeWidget config={config as never} height={800} />
    </div>,
  );
  // Generous timeout: the widget dynamic-imports `qrcode` (a ~50KB chunk it
  // deliberately keeps out of the shared widget bundle), so the first render in
  // a suite pays the module load. waitFor's own default is 1s, which is not it.
  const img = await waitFor(() => {
    const el = document.querySelector('img[src^="data:image/png"]') as HTMLImageElement | null;
    if (!el) throw new Error('no generated code yet');
    return el;
  }, { timeout: 15_000 });
  return decodeQr(img.getAttribute('src') || '');
}

describe('QR_CODE renders a code a phone can actually read', () => {
  it('a link — and a bare domain is made absolute, or the phone just searches for it', async () => {
    expect(await renderAndDecode({ mode: 'url', value: 'venue-os.app/lunch' }))
      .toBe('https://venue-os.app/lunch');
  });

  it('guest Wi-Fi, with a semicolon in the password surviving the round trip', async () => {
    // The escaping is the whole reason this test exists: an unescaped ';'
    // silently terminates the field and the network never joins.
    expect(await renderAndDecode({ mode: 'wifi', ssid: 'Springfield Guest', password: 'p;ss word', encryption: 'WPA' }))
      .toBe('WIFI:T:WPA;S:Springfield Guest;P:p\\;ss word;;');
  });

  it('a phone number, stripped of formatting', async () => {
    expect(await renderAndDecode({ mode: 'tel', value: '+1 (555) 010-4477' })).toBe('tel:+15550104477');
  });

  it('a contact card', async () => {
    expect(await renderAndDecode({ mode: 'contact', contactName: 'Jane Doe', contactPhone: '5550104477' }))
      .toBe('MECARD:N:Jane Doe;TEL:5550104477;;');
  });

  it('shows the empty state — not an unscannable placeholder — with nothing configured', async () => {
    render(
      <div style={{ position: 'relative', width: 1200, height: 800 }}>
        <QrCodeWidget config={{ mode: 'url', value: '' } as never} height={800} />
      </div>,
    );
    expect(document.querySelector('img[src^="data:image/png"]')).toBeNull();
    expect(screen.getByText(/Add a link to share/i)).toBeTruthy();
  });

  it('never prints the Wi-Fi password as the auto caption, but does show it as a labelled field', async () => {
    render(
      <div style={{ position: 'relative', width: 1200, height: 800 }}>
        <QrCodeWidget config={{ mode: 'wifi', ssid: 'Guest', password: 'hunter2' } as never} height={800} />
      </div>,
    );
    await waitFor(() => expect(document.querySelector('img[src^="data:image/png"]')).toBeTruthy(), { timeout: 15_000 });
    // Shown deliberately, under a "Network" heading — guests without a camera
    // still need to type it. What must never happen is it leaking into the
    // generic caption slot where a URL host would go.
    expect(screen.getByText('hunter2')).toBeTruthy();
    expect(screen.getByText('Network')).toBeTruthy();
  });
});
