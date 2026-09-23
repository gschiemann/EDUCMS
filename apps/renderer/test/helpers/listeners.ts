/**
 * Local TCP + UDP listeners that record EVERYTHING that reaches them — a TCP
 * connection is counted even if no HTTP request follows (a preconnect).
 */
import http from 'node:http';
import dgram from 'node:dgram';
import type { AddressInfo } from 'node:net';

export interface Listeners {
  port: number;
  udpPort: number;
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
  await new Promise<void>((resolve) => udp.bind(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    udpPort: udp.address().port,
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
