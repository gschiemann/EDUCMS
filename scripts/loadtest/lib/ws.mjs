/**
 * ws.mjs — a minimal RFC-6455 client, because the harness may not add deps and
 * a worktree has no node_modules.
 *
 * Enough of the protocol for what the player actually does on `/realtime`:
 * HTTP Upgrade, masked text frames out, unmasked text frames in, ping/pong,
 * close. Fragmentation and binary frames are not used by the gateway (JSON
 * only), so they are handled as "reassemble continuation, ignore binary".
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class MiniWs extends EventEmitter {
  constructor(url, { headers = {} } = {}) {
    super();
    this.url = new URL(url);
    this.headers = headers;
    this.socket = null;
    this.open = false;
    this.buf = Buffer.alloc(0);
    this.fragOp = null;
    this.fragChunks = [];
  }

  connect() {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: this.url.hostname,
      port: this.url.port,
      path: this.url.pathname + this.url.search,
      method: 'GET',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
        ...this.headers,
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const expect = crypto.createHash('sha1').update(key + GUID).digest('base64');
      if (res.headers['sec-websocket-accept'] !== expect) {
        socket.destroy();
        this.emit('error', new Error('bad accept'));
        return;
      }
      this.socket = socket;
      this.open = true;
      socket.on('data', (d) => this._onData(d));
      socket.on('close', () => {
        this.open = false;
        this.emit('close');
      });
      socket.on('error', (e) => {
        this.open = false;
        this.emit('error', e);
      });
      if (head && head.length) this._onData(head);
      this.emit('open');
    });
    req.on('error', (e) => this.emit('error', e));
    req.on('response', (res) => this.emit('error', new Error(`upgrade refused ${res.statusCode}`)));
    req.end();
    return this;
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        len = Number(this.buf.readBigUInt64BE(2));
        off = 10;
      }
      let mask = null;
      if (masked) {
        if (this.buf.length < off + 4) return;
        mask = this.buf.subarray(off, off + 4);
        off += 4;
      }
      if (this.buf.length < off + len) return;
      let payload = Buffer.from(this.buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      this.buf = this.buf.subarray(off + len);

      if (opcode === 0x8) {
        this.close();
        continue;
      }
      if (opcode === 0x9) {
        this._frame(0xa, payload);
        continue;
      }
      if (opcode === 0xa) continue;
      if (opcode === 0x0) {
        this.fragChunks.push(payload);
        if (fin) {
          const full = Buffer.concat(this.fragChunks);
          this.fragChunks = [];
          if (this.fragOp === 0x1) this._text(full);
          this.fragOp = null;
        }
        continue;
      }
      if (!fin) {
        this.fragOp = opcode;
        this.fragChunks = [payload];
        continue;
      }
      if (opcode === 0x1) this._text(payload);
    }
  }

  _text(buf) {
    let msg = null;
    try {
      msg = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    this.emit('message', msg);
  }

  _frame(opcode, payload) {
    if (!this.socket || this.socket.destroyed) return;
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.from(payload);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    try {
      this.socket.write(Buffer.concat([header, mask, masked]));
    } catch {
      /* socket gone; the caller sees it via 'close' */
    }
  }

  send(obj) {
    this._frame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  close() {
    this.open = false;
    try {
      this.socket?.destroy();
    } catch {
      /* already gone */
    }
  }
}
