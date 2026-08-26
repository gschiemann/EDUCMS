/**
 * State walkthrough for the device-first connect card — every state the
 * operator can actually land in:
 *
 *   • 0 screens paired  → full card, Android preselected, "Most common"
 *   • 3 screens paired  → slim "Connect another screen" row, expands on tap
 *   • each of the three device choices → only that path's steps
 *   • the choice survives a remount (localStorage, per browser)
 *   • both pairing exits reach the things that already exist
 *
 * `qrcode` is mocked: `toDataURL` needs canvas/pngjs work that is irrelevant
 * here, and the QR's CONTENT is what matters — so the mock records exactly
 * what URL each code was asked to encode, which is the assertion that keeps
 * a fabricated APK link from ever shipping.
 *
 * Every render / click goes through the `mount` + `click` helpers so the
 * mocked QR promise settles INSIDE `act()` — otherwise React 19 logs an
 * "update not wrapped in act(...)" warning for each encode.
 */

import React from 'react';
import {
  render, screen, fireEvent, waitFor, cleanup, act,
  type RenderResult,
} from '@testing-library/react';
import '@testing-library/jest-dom';

const encoded: string[] = [];
jest.mock('qrcode', () => ({
  __esModule: true,
  default: {
    toDataURL: (text: string) => {
      encoded.push(text);
      return Promise.resolve(`data:image/png;base64,QR(${text})`);
    },
  },
}));

import { ConnectScreenCard } from '../ConnectScreenCard';
import { CONNECT_PATH_STORAGE_KEY } from '../connectPaths';
import { API_URL } from '@/lib/api-url';

const EXPECTED_APK_URL = `${API_URL}/player/apk/latest`;

async function mount(
  overrides: Partial<React.ComponentProps<typeof ConnectScreenCard>> = {},
): Promise<RenderResult & { onPairScreen: jest.Mock }> {
  const onPairScreen = jest.fn();
  let utils!: RenderResult;
  await act(async () => {
    utils = render(
      <ConnectScreenCard
        pairedCount={0}
        playerUrl="https://venue-os.app/player"
        onPairScreen={onPairScreen}
        {...overrides}
      />,
    );
  });
  return Object.assign(utils, { onPairScreen });
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.click(el); });
}

beforeEach(() => {
  encoded.length = 0;
  window.localStorage.clear();
});
afterEach(cleanup);

describe('ConnectScreenCard — 0 screens paired (first-run)', () => {
  it('shows the full card, not the slim row', async () => {
    await mount({ pairedCount: 0 });
    expect(screen.getByTestId('connect-screen-card')).toBeInTheDocument();
    expect(screen.queryByTestId('connect-screen-collapsed')).not.toBeInTheDocument();
  });

  it('asks the device question and offers all three paths', async () => {
    await mount({ pairedCount: 0 });
    expect(screen.getByText('What are you setting up?')).toBeInTheDocument();
    expect(screen.getByTestId('connect-path-android')).toBeInTheDocument();
    expect(screen.getByTestId('connect-path-media-player')).toBeInTheDocument();
    expect(screen.getByTestId('connect-path-browser')).toBeInTheDocument();
  });

  it('defaults to Android and badges it Most common', async () => {
    await mount({ pairedCount: 0 });
    expect(screen.getByTestId('connect-path-android')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('connect-path-browser')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Most common')).toBeInTheDocument();
  });
});

describe('ConnectScreenCard — 3 screens paired (past onboarding)', () => {
  it('collapses to a single "Connect another screen" row', async () => {
    await mount({ pairedCount: 3 });
    const row = screen.getByTestId('connect-screen-collapsed');
    expect(row).toBeInTheDocument();
    expect(row).toHaveTextContent('Connect another screen');
    expect(screen.queryByTestId('connect-screen-card')).not.toBeInTheDocument();
  });

  it('does not encode any QR while collapsed', async () => {
    await mount({ pairedCount: 3 });
    expect(encoded).toHaveLength(0);
  });

  it('expands on tap, and can be collapsed again', async () => {
    await mount({ pairedCount: 3 });
    await click(screen.getByTestId('connect-screen-collapsed'));
    expect(screen.getByTestId('connect-screen-card')).toBeInTheDocument();

    await click(screen.getByLabelText('Collapse connect instructions'));
    expect(screen.getByTestId('connect-screen-collapsed')).toBeInTheDocument();
  });

  it('offers no collapse control at all when nothing is paired yet', async () => {
    await mount({ pairedCount: 0 });
    expect(screen.queryByLabelText('Collapse connect instructions')).not.toBeInTheDocument();
  });
});

describe('ConnectScreenCard — Android path', () => {
  it('leads with installing the app, not with a browser URL', async () => {
    await mount();
    expect(
      screen.getByText('Install the VenueOS Player app on the screen'),
    ).toBeInTheDocument();
    expect(screen.getByText(/6-character code/)).toBeInTheDocument();
  });

  it('shows the REAL APK endpoint and encodes exactly that into the QR', async () => {
    await mount();
    // The download anchor points at the live OTA endpoint.
    expect(screen.getByTestId('connect-apk-download')).toHaveAttribute(
      'href',
      EXPECTED_APK_URL,
    );
    expect(screen.getByText(/Download the APK here/)).toBeInTheDocument();
    // And the QR encodes it verbatim — no invented URL can slip through.
    await waitFor(() => expect(screen.getByTestId('connect-apk-qr')).toBeInTheDocument());
    expect(encoded).toContain(EXPECTED_APK_URL);
  });

  // ── C3, 2026-08-25 — "remove the copy URL field and keep just the
  //    download APK". The read-only URL field and its Copy URL button are
  //    gone; the QR (how the link reaches the SCREEN) and the download
  //    button (how it reaches the machine you are standing at) stay.
  // 2026-08-25 operator: plenty of commercial panels have no browser and no
  // way to scan the QR, but every one of them has a USB port and a file
  // manager — so the sideload step names that route explicitly.
  it('names the USB route on the APK step', async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId('connect-apk-usb')).toBeInTheDocument());
    const usb = screen.getByTestId('connect-apk-usb').textContent || '';
    expect(usb).toMatch(/USB stick/i);
    expect(usb).toMatch(/file manager/i);
  });

  it('offers no copy-URL control on the APK step — only the QR and the button', async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId('connect-apk-qr')).toBeInTheDocument());
    expect(screen.getByTestId('connect-apk-download')).toBeInTheDocument();

    // No copy control of any kind while the phone panel is closed — that
    // catches the deleted field's button by its old aria-label AND by the
    // generic "Copy URL" label the shared CopyButton renders.
    expect(
      screen.queryByLabelText('Copy the Player APK download link'),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /copy/i })).toHaveLength(0);
    // The URL is no longer rendered as standalone text anywhere on the card.
    expect(screen.queryByText(EXPECTED_APK_URL)).not.toBeInTheDocument();
  });
});

// C2, 2026-08-25 — operator: "install apk should not be the same as media
// player ... media player should be instructions on how to plugin a venue os
// media player to their existing screen". These tests exist to keep this
// path from collapsing back into a clone of the Android sideload flow.
describe('ConnectScreenCard — media player path (its OWN steps, not the APK flow)', () => {
  it('teaches the physical hookup: HDMI, power, input, code, pair', async () => {
    await mount();
    await click(screen.getByTestId('connect-path-media-player'));
    expect(screen.getByText('Plug the player into the display')).toBeInTheDocument();
    expect(screen.getByText(/any free HDMI input, then give it power/)).toBeInTheDocument();
    expect(screen.getByText('Switch the display to that input')).toBeInTheDocument();
    expect(screen.getByText(/It starts up and shows a 6-character code/)).toBeInTheDocument();
    expect(screen.getByText('Pair it')).toBeInTheDocument();
  });

  it('does NOT render the Android sideload flow', async () => {
    await mount();
    encoded.length = 0; // the card opens on Android, which legitimately encodes
    await click(screen.getByTestId('connect-path-media-player'));

    // No sideload step title, no big APK QR, no primary download button.
    expect(
      screen.queryByText('Install the VenueOS Player app on the screen'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Install the VenueOS Player app on the media player/))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId('connect-apk-qr')).not.toBeInTheDocument();
    expect(screen.queryByTestId('connect-apk-download')).not.toBeInTheDocument();
    expect(screen.queryByText(/Download the APK here/)).not.toBeInTheDocument();
    // The USB sideload line belongs to the APK path only — a preloaded
    // VenueOS player has nothing to sideload.
    expect(screen.queryByTestId('connect-apk-usb')).not.toBeInTheDocument();
    // And it encodes no QR at all — this path costs the phone nothing.
    expect(encoded).not.toContain(EXPECTED_APK_URL);
  });

  it('leads with the preloaded VenueOS player, no sideload', async () => {
    await mount();
    await click(screen.getByTestId('connect-path-media-player'));
    expect(
      screen.getByText(/preloaded with the Player app, so there is nothing to sideload/),
    ).toBeInTheDocument();
  });

  it('keeps the APK as a clearly SECONDARY route for a stick they already own', async () => {
    await mount();
    await click(screen.getByTestId('connect-path-media-player'));
    const byo = screen.getByTestId('connect-byo-apk-link');
    expect(byo).toHaveAttribute('href', EXPECTED_APK_URL);
    expect(screen.getByText(/Using an Android stick you already own/)).toBeInTheDocument();
  });

  it('invents no product specifics we cannot support', async () => {
    await mount();
    await click(screen.getByTestId('connect-path-media-player'));
    const copy = screen.getByTestId('connect-screen-card').textContent ?? '';
    // No model names, dimensions, price, packaging, shipping or ordering.
    for (const banned of [
      /\$\d/, /\bin the box\b/i, /\bincluded\b/i, /\bship(ping|s|ped)?\b/i,
      /\border (one|now|your)\b/i, /\bbuy\b/i, /\bmm\b/, /\binch(es)?\b/i,
    ]) {
      expect(copy).not.toMatch(banned);
    }
  });

  it('states only first-boot behaviour the app actually implements', async () => {
    await mount();
    await click(screen.getByTestId('connect-path-media-player'));
    // SetupCeremony offers its grants one dialog at a time and includes the
    // HOME-app step; MainActivity holds FLAG_KEEP_SCREEN_ON.
    expect(screen.getByText(/one dialog at a time/)).toBeInTheDocument();
    expect(screen.getByText(/Home app/)).toBeInTheDocument();
    expect(screen.getByText(/holds the panel awake/)).toBeInTheDocument();
  });
});

describe('ConnectScreenCard — browser path (today’s flow, kept)', () => {
  it('shows the Player URL and no APK step', async () => {
    await mount();
    // The card opens on Android, which legitimately encodes the APK QR;
    // reset the recorder so this asserts what the BROWSER path does.
    encoded.length = 0;
    await click(screen.getByTestId('connect-path-browser'));
    expect(screen.getByText('Open the Player URL on the display')).toBeInTheDocument();
    expect(screen.getByText('https://venue-os.app/player')).toBeInTheDocument();
    expect(screen.queryByTestId('connect-apk-qr')).not.toBeInTheDocument();
    expect(encoded).not.toContain(EXPECTED_APK_URL);
  });
});

describe('ConnectScreenCard — the choice is remembered per browser', () => {
  it('persists to localStorage and reopens on that path', async () => {
    const first = await mount();
    await click(screen.getByTestId('connect-path-browser'));
    expect(window.localStorage.getItem(CONNECT_PATH_STORAGE_KEY)).toBe('browser');
    first.unmount();

    await mount();
    expect(screen.getByTestId('connect-path-browser')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Open the Player URL on the display')).toBeInTheDocument();
  });

  it('falls back to Android when the stored value is junk', async () => {
    window.localStorage.setItem(CONNECT_PATH_STORAGE_KEY, 'firestick');
    await mount();
    expect(screen.getByTestId('connect-path-android')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ConnectScreenCard — both paths end at the existing pairing entries', () => {
  it('opens the page’s Pair Screen modal', async () => {
    const { onPairScreen } = await mount();
    await click(screen.getByTestId('connect-pair-screen'));
    expect(onPairScreen).toHaveBeenCalledTimes(1);
  });

  it('disables that button for a read-only viewer', async () => {
    const { onPairScreen } = await mount({ pairDisabled: true });
    const btn = screen.getByTestId('connect-pair-screen');
    expect(btn).toBeDisabled();
    await click(btn);
    expect(onPairScreen).not.toHaveBeenCalled();
  });

  it('reveals the phone scanner QR pointing at /pair, only on request', async () => {
    await mount();
    expect(screen.queryByTestId('connect-phone-qr-panel')).not.toBeInTheDocument();

    await click(screen.getByTestId('connect-phone-pair-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('connect-phone-qr-panel')).toBeInTheDocument(),
    );
    expect(encoded).toContain(`${window.location.origin}/pair`);
  });

  it('offers the pairing exits on every device path', async () => {
    await mount();
    for (const p of ['android', 'media-player', 'browser'] as const) {
      await click(screen.getByTestId(`connect-path-${p}`));
      expect(screen.getByTestId('connect-pair-screen')).toBeInTheDocument();
      expect(screen.getByTestId('connect-phone-pair-toggle')).toBeInTheDocument();
    }
  });
});
