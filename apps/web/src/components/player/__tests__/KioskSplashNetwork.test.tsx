/**
 * The splash tells the truth about the network (2026-10-26, on site): the chip
 * was a hard-coded "Online" and "Connecting to your CMS…" spun for ever with
 * the Wi-Fi removed.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { KioskSplash, type SplashNetwork } from '../KioskSplash';

const net = (over: Partial<SplashNetwork>): SplashNetwork => ({ status: 'online', card: true, parkFocus: true, ...over });
const chip = () => document.querySelector('[data-edu-network-chip]');
const card = () => document.querySelector('[data-edu-network-card]');

describe('KioskSplash — network chip', () => {
  it('server render / first pass: "Checking…", never a claim it cannot make', () => {
    render(<KioskSplash mode="registering" />);
    expect(chip()).toHaveAttribute('data-edu-network-chip', 'checking');
    expect(chip()).toHaveTextContent('Checking…');
    expect(screen.getByText(/Connecting to your CMS/)).toBeInTheDocument();
  });

  it.each([
    ['online', 'Online'],
    ['unreachable', 'No internet'],
    ['offline', 'Offline'],
  ] as const)('%s → "%s"', (status, label) => {
    render(<KioskSplash mode="registering" network={net({ status, card: false })} />);
    expect(chip()).toHaveTextContent(label);
  });
});

describe('KioskSplash — the network card', () => {
  it('offline: the card replaces the spinner copy, the button is focused, OK opens the Network screen', () => {
    const open = jest.fn();
    render(<KioskSplash mode="registering" network={net({ status: 'offline', onOpenSettings: open })} />);
    expect(screen.getByRole('heading', { name: 'No network connection' })).toBeInTheDocument();
    expect(screen.getByText(/This screen isn.t connected to/)).toHaveTextContent("This screen isn't connected to Wi-Fi or Ethernet.");
    expect(screen.queryByText(/Connecting to your CMS/)).toBeNull();
    const button = screen.getByRole('button', { name: 'Open network settings' });
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByText('This screen reconnects by itself as soon as the network is back.')).toBeInTheDocument();
  });

  it('unreachable: says the network is up but VenueOS is not', () => {
    render(<KioskSplash mode="registering" network={net({ status: 'unreachable', onOpenSettings: () => {} })} />);
    expect(screen.getByRole('heading', { name: "Connected, but can't reach VenueOS" })).toBeInTheDocument();
    expect(screen.getByText("Check this network's internet connection.")).toBeInTheDocument();
    expect(card()).toHaveAttribute('data-edu-network-card', 'unreachable');
  });

  it('no Network screen on this APK / in a browser: the instruction instead of a button', () => {
    render(<KioskSplash mode="registering" network={net({ status: 'offline', hint: 'Press Back, choose Exit to launcher, then open Wi-Fi settings.' })} />);
    expect(screen.queryByRole('button', { name: 'Open network settings' })).toBeNull();
    expect(screen.getByText('Press Back, choose Exit to launcher, then open Wi-Fi settings.')).toBeInTheDocument();
  });

  it('never while an alert is up: card=false keeps the plain splash (the chip stays honest)', () => {
    render(<KioskSplash mode="registering" network={net({ status: 'offline', card: false, onOpenSettings: () => {} })} />);
    expect(card()).toBeNull();
    expect(screen.getByText(/Connecting to your CMS/)).toBeInTheDocument();
    expect(chip()).toHaveTextContent('Offline');
  });

  it('online / checking: no card', () => {
    const { rerender } = render(<KioskSplash mode="registering" network={net({ status: 'online' })} />);
    expect(card()).toBeNull();
    rerender(<KioskSplash mode="registering" network={net({ status: 'checking' })} />);
    expect(card()).toBeNull();
  });

  it('pairing: the card takes the pairing block’s place, and the code returns with the network', () => {
    const { rerender } = render(
      <KioskSplash mode="pairing" pairingCode="ABC123" network={net({ status: 'offline', onOpenSettings: () => {} })} />,
    );
    expect(card()).not.toBeNull();
    expect(document.querySelector('.kiosk-code-row')).toBeNull();
    rerender(<KioskSplash mode="pairing" pairingCode="ABC123" network={net({ status: 'online' })} />);
    expect(card()).toBeNull();
    expect(document.querySelector('.kiosk-code-row')).not.toBeNull();
  });

  it('the Back menu owns the remote while open; focus is parked again when it closes', () => {
    const { rerender } = render(
      <KioskSplash mode="registering" network={net({ status: 'offline', onOpenSettings: () => {}, parkFocus: false })} />,
    );
    const button = screen.getByRole('button', { name: 'Open network settings' });
    expect(button).not.toHaveFocus();
    rerender(<KioskSplash mode="registering" network={net({ status: 'offline', onOpenSettings: () => {}, parkFocus: true })} />);
    expect(button).toHaveFocus();
  });

  it('never takes focus from a control that has it', () => {
    const outside = document.createElement('input');
    document.body.appendChild(outside);
    outside.focus();
    render(<KioskSplash mode="registering" network={net({ status: 'offline', onOpenSettings: () => {} })} />);
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
