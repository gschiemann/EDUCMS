/**
 * Local TCP + UDP listeners that record EVERYTHING that reaches them — a TCP
 * connection is counted even if no HTTP request follows (a preconnect).
 */
import http from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import type { AddressInfo } from 'node:net';

/**
 * The address the UDP listener binds to: this machine's first non-internal
 * IPv4, else loopback. Linux Chromium gathers no WebRTC candidates on loopback,
 * so a STUN server at 127.0.0.1 is never contacted there — not even by a stock
 * browser — and the CONTROL ("a stock Chromium DOES send STUN") failed on the
 * GitHub runner while passing on macOS (2026-09-23). On a real interface the
 * control leaks on every OS, so the lockdown's "0 datagrams" means the same
 * thing everywhere.
 */
function udpBindHost(): string {
  // Prefer the machine's primary NIC. A container bridge / veth / VM adapter
  // (docker0 on the GitHub runner) is a real IPv4 too, but Chromium does not
  // reliably gather ICE candidates on it — binding there made the control flaky.
  const virtual = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|lxc|cni|flannel|cali|kube)/i;
  const primary = /^(eth|en|wlan|wl)/i;
  let fallback: string | null = null;
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (virtual.test(name)) continue;
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (primary.test(name)) return a.address;
      if (!fallback) fallback = a.address;
    }
  }
  return fallback || '127.0.0.1';
}

export interface Listeners {
  port: number;
  udpPort: number;
  /** Where the UDP listener is bound (see udpBindHost). */
  udpHost: string;
  connections: string[];
  requests: string[];
  udpPackets: number;
  close(): Promise<void>;
}

export async function startListeners(): Promise<Listeners> {
  const state = { connections: [] as string[], requests: [] as string[], udpPackets: 0 };
  const server = http.createServer((req, res) => {
    state.requests.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
    res.end('leaked');
  });
  server.on('connection', (socket) => state.connections.push(`${socket.remoteAddress}:${socket.remotePort}`));
  server.on('upgrade', (req, socket) => {
    state.requests.push(`UPGRADE ${req.url}`);
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const udp = dgram.createSocket('udp4');
  udp.on('message', () => {
    state.udpPackets += 1;
  });
  const udpHost = udpBindHost();
  await new Promise<void>((resolve) => udp.bind(0, udpHost, () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    udpPort: udp.address().port,
    udpHost,
    get connections() {
      return state.connections;
    },
    get requests() {
      return state.requests;
    },
    get udpPackets() {
      return state.udpPackets;
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await new Promise<void>((resolve) => udp.close(() => resolve()));
    },
  };
}
