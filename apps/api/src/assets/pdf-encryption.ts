/**
 * Can anyone open this PDF without a password? (2026-10-05, PDF pages on
 * screens.)
 *
 * A PDF "protected" against editing or printing carries an OWNER password and
 * an EMPTY user password: every viewer opens it, and so does our page renderer.
 * A PDF that needs a password TO OPEN carries a real user password: no screen
 * could ever show it, so the upload refuses it in plain words ("This PDF is
 * password-protected. Remove the password and upload it again.") instead of
 * accepting a file that would only ever read "can't be shown" later.
 *
 * The test is the one every viewer runs first — try the empty user password
 * against the Standard security handler's `/U` entry — for every revision:
 *   R2 (RC4 40-bit), R3 / R4 (RC4 or AES-128): Algorithms 2, 4, 5 of ISO 32000-1
 *   R5 (AES-256, Adobe extension level 3):   SHA-256(password ‖ validation salt)
 *   R6 (AES-256, PDF 2.0):                    Algorithm 2.B of ISO 32000-2
 * It decrypts nothing and renders nothing: a few hashes over at most 48 bytes,
 * plus a small, bounded parse of the trailer and the encryption dictionary. A
 * file it cannot make sense of is `unknown` — accepted, exactly as before — and
 * the page renderer (pdf.js) remains the final word.
 *
 * Pure: no I/O, no Nest. RC4 is written out here because OpenSSL 3 moved it to
 * the legacy provider, which Node does not load.
 */
import { createCipheriv, createHash } from 'crypto';

export type PdfOpenVerdict =
  | { status: 'not-encrypted' }
  /** Encrypted, but the empty user password opens it (an owner password only). */
  | { status: 'opens' }
  /** Needs a password (or a certificate) to open at all. */
  | { status: 'needs-password'; detail: string }
  | { status: 'unknown'; why: string };

/** The 32-byte padding string of ISO 32000-1 Algorithm 2, step a. */
const PAD = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);

/** `/Encrypt` as a KEY — never `/EncryptMetadata`. */
const ENCRYPT_KEY = /\/Encrypt(?![A-Za-z0-9#])/g;

/** Does this slice of a PDF mention an `/Encrypt` entry? (cheap pre-check on head / tail reads) */
export function mentionsEncrypt(...windows: Array<Buffer | null | undefined>): boolean {
  for (const w of windows) {
    if (!w || w.length === 0) continue;
    ENCRYPT_KEY.lastIndex = 0;
    if (ENCRYPT_KEY.test(w.toString('latin1'))) return true;
  }
  return false;
}

/** The whole file → can it be opened without a password? Never throws. */
export function pdfOpenVerdict(file: Buffer): PdfOpenVerdict {
  try {
    return evaluate(file.toString('latin1'));
  } catch (e) {
    return { status: 'unknown', why: `could not read the encryption entry: ${(e as Error).message}`.slice(0, 160) };
  }
}

function evaluate(text: string): PdfOpenVerdict {
  // The LAST /Encrypt key belongs to the newest revision's trailer.
  let last = -1;
  ENCRYPT_KEY.lastIndex = 0;
  for (let m = ENCRYPT_KEY.exec(text); m; m = ENCRYPT_KEY.exec(text)) last = m.index;
  if (last < 0) return { status: 'not-encrypted' };

  const trailerStart = enclosingDictStart(text, last);
  if (trailerStart < 0) return { status: 'unknown', why: 'no dictionary around /Encrypt' };
  const trailer = new PdfLexer(text, trailerStart).value();
  if (!isDict(trailer)) return { status: 'unknown', why: 'the trailer is not a dictionary' };

  let encrypt = trailer.get('Encrypt');
  if (isRef(encrypt)) encrypt = resolve(text, encrypt);
  if (!isDict(encrypt)) return { status: 'unknown', why: 'the encryption dictionary could not be found' };

  const filter = encrypt.get('Filter');
  if (!isName(filter) || filter.name !== 'Standard') {
    return { status: 'needs-password', detail: `encrypted with ${isName(filter) ? filter.name : 'an unknown handler'}` };
  }
  const r = num(encrypt.get('R'));
  const u = bytes(encrypt.get('U'));
  if (!r || !u) return { status: 'unknown', why: 'no /R or /U' };
  const empty = Buffer.alloc(0);

  if (r === 5 || r === 6) {
    if (u.length < 40) return { status: 'unknown', why: `a ${u.length}-byte /U for R${r}` };
    const salt = u.subarray(32, 40);
    const hash = r === 5 ? sha('sha256', empty, salt) : hash2B(empty, salt, empty);
    return hash.equals(u.subarray(0, 32))
      ? { status: 'opens' }
      : { status: 'needs-password', detail: `R${r}: the empty user password does not match` };
  }

  if (r < 2 || r > 4) return { status: 'unknown', why: `security handler revision ${r}` };
  const o = bytes(encrypt.get('O'));
  const p = num(encrypt.get('P'));
  if (!o || o.length < 32 || p === null || u.length < 16) return { status: 'unknown', why: 'no usable /O, /P or /U' };
  const ids = trailer.get('ID');
  const id0 = Array.isArray(ids) ? bytes(ids[0]) ?? empty : empty;
  const v = num(encrypt.get('V')) ?? 0;
  const lengthBits = num(encrypt.get('Length')) ?? 40;
  const n = r === 2 ? 5 : r === 4 || v === 4 ? 16 : Math.max(5, Math.min(16, Math.floor(lengthBits / 8)));
  const encryptMetadata = encrypt.get('EncryptMetadata') !== false;

  // Algorithm 2: the file key from the (empty, so padded) user password.
  const pLe = Buffer.alloc(4);
  pLe.writeInt32LE(p | 0);
  let h = sha('md5', PAD, o.subarray(0, 32), pLe, id0, r >= 4 && !encryptMetadata ? Buffer.from([255, 255, 255, 255]) : empty);
  if (r >= 3) for (let i = 0; i < 50; i += 1) h = sha('md5', h.subarray(0, n));
  const key = h.subarray(0, n);

  if (r === 2) {
    // Algorithm 4: /U is RC4(key, PAD), all 32 bytes.
    return rc4(key, PAD).equals(u.subarray(0, 32))
      ? { status: 'opens' }
      : { status: 'needs-password', detail: 'R2: the empty user password does not match' };
  }
  // Algorithm 5: MD5(PAD ‖ ID0), RC4 with the key, then 19 more passes with key ^ i.
  let x = rc4(key, sha('md5', PAD, id0));
  for (let i = 1; i <= 19; i += 1) x = rc4(Buffer.from(key.map((b) => b ^ i)), x);
  return x.subarray(0, 16).equals(u.subarray(0, 16))
    ? { status: 'opens' }
    : { status: 'needs-password', detail: `R${r}: the empty user password does not match` };
}

/** ISO 32000-2 Algorithm 2.B — the R6 password hash. */
function hash2B(password: Buffer, salt: Buffer, udata: Buffer): Buffer {
  let k = sha('sha256', password, salt, udata);
  let e: Buffer = Buffer.from([0]);
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i += 1) {
    const unit = Buffer.concat([password, k, udata]);
    const k1 = Buffer.concat(new Array<Buffer>(64).fill(unit));
    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    e = Buffer.concat([cipher.update(k1), cipher.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j += 1) sum += e[j];
    const algo = sum % 3 === 0 ? 'sha256' : sum % 3 === 1 ? 'sha384' : 'sha512';
    k = sha(algo, e);
    if (i > 2000) throw new Error('R6 hash did not settle');
  }
  return k.subarray(0, 32);
}

function sha(algo: string, ...parts: Buffer[]): Buffer {
  const h = createHash(algo);
  for (const p of parts) h.update(p);
  return h.digest();
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) s[i] = i;
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// ── a small, bounded reader for the few PDF objects this needs ─────────────

type PdfValue =
  | number
  | boolean
  | null
  | Buffer
  | PdfName
  | PdfRef
  | PdfValue[]
  | Map<string, PdfValue>;
interface PdfName { name: string }
interface PdfRef { ref: number; gen: number }

const isDict = (v: unknown): v is Map<string, PdfValue> => v instanceof Map;
const isName = (v: unknown): v is PdfName => !!v && typeof v === 'object' && 'name' in (v as object);
const isRef = (v: unknown): v is PdfRef => !!v && typeof v === 'object' && 'ref' in (v as object);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bytes = (v: unknown): Buffer | null => (Buffer.isBuffer(v) ? v : null);

/** Where does the dictionary that contains `pos` start? (`<<` with balanced nesting) */
function enclosingDictStart(text: string, pos: number): number {
  let depth = 0;
  for (let i = pos - 1; i >= Math.max(0, pos - 65_536); i -= 1) {
    if (text[i] === '>' && text[i - 1] === '>') {
      depth += 1;
      i -= 1;
    } else if (text[i] === '<' && text[i - 1] === '<') {
      if (depth === 0) return i - 1;
      depth -= 1;
      i -= 1;
    }
  }
  return -1;
}

/** The value of indirect object `ref`: its LAST definition (incremental updates replace). */
function resolve(text: string, ref: PdfRef): PdfValue {
  const re = new RegExp(`(?:^|[^0-9])${ref.ref}\\s+${ref.gen}\\s+obj\\b`, 'g');
  let at = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) at = m.index + m[0].length;
  if (at < 0) return null;
  return new PdfLexer(text, at).value();
}

class PdfLexer {
  private depth = 0;
  constructor(private readonly s: string, private i: number) {}

  value(): PdfValue {
    if (++this.depth > 32) throw new Error('nested too deeply');
    try {
      this.ws();
      const c = this.s[this.i];
      if (c === undefined) throw new Error('unexpected end');
      if (c === '<' && this.s[this.i + 1] === '<') return this.dict();
      if (c === '<') return this.hex();
      if (c === '(') return this.literal();
      if (c === '[') return this.array();
      if (c === '/') return { name: this.name() };
      if (/[0-9+\-.]/.test(c)) return this.numberOrRef();
      for (const [word, v] of [['true', true], ['false', false], ['null', null]] as const) {
        if (this.s.startsWith(word, this.i)) {
          this.i += word.length;
          return v;
        }
      }
      throw new Error(`unexpected ${JSON.stringify(c)}`);
    } finally {
      this.depth -= 1;
    }
  }

  private ws(): void {
    for (;;) {
      const c = this.s[this.i];
      if (c === '%') {
        while (this.i < this.s.length && this.s[this.i] !== '\n' && this.s[this.i] !== '\r') this.i += 1;
      } else if (c !== undefined && ' \t\r\n\f\0'.includes(c)) {
        this.i += 1;
      } else {
        return;
      }
    }
  }

  private dict(): Map<string, PdfValue> {
    this.i += 2;
    const out = new Map<string, PdfValue>();
    for (let guard = 0; guard < 512; guard += 1) {
      this.ws();
      if (this.s.startsWith('>>', this.i)) {
        this.i += 2;
        return out;
      }
      if (this.s[this.i] !== '/') throw new Error('a dictionary key is not a name');
      const key = this.name();
      out.set(key, this.value());
    }
    throw new Error('dictionary too long');
  }

  private array(): PdfValue[] {
    this.i += 1;
    const out: PdfValue[] = [];
    for (let guard = 0; guard < 512; guard += 1) {
      this.ws();
      if (this.s[this.i] === ']') {
        this.i += 1;
        return out;
      }
      out.push(this.value());
    }
    throw new Error('array too long');
  }

  private name(): string {
    this.i += 1;
    let out = '';
    while (this.i < this.s.length && !/[\s/<>[\]()%{}]/.test(this.s[this.i])) {
      if (this.s[this.i] === '#' && /^[0-9a-fA-F]{2}$/.test(this.s.substr(this.i + 1, 2))) {
        out += String.fromCharCode(parseInt(this.s.substr(this.i + 1, 2), 16));
        this.i += 3;
      } else {
        out += this.s[this.i];
        this.i += 1;
      }
    }
    return out;
  }

  private hex(): Buffer {
    const end = this.s.indexOf('>', this.i);
    if (end < 0 || end - this.i > 4096) throw new Error('unterminated hex string');
    let digits = this.s.slice(this.i + 1, end).replace(/[^0-9a-fA-F]/g, '');
    if (digits.length % 2) digits += '0';
    this.i = end + 1;
    return Buffer.from(digits, 'hex');
  }

  private literal(): Buffer {
    this.i += 1;
    const out: number[] = [];
    let nest = 0;
    while (this.i < this.s.length && out.length < 4096) {
      const c = this.s[this.i];
      if (c === '\\') {
        const n = this.s[this.i + 1];
        const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
        if (n !== undefined && n in map) {
          out.push(map[n]);
          this.i += 2;
        } else if (n !== undefined && /[0-7]/.test(n)) {
          const oct = /^[0-7]{1,3}/.exec(this.s.substr(this.i + 1, 3))![0];
          out.push(parseInt(oct, 8) & 255);
          this.i += 1 + oct.length;
        } else if (n === '\r' || n === '\n') {
          // A backslash before an end of line continues the string.
          this.i += 2;
          if (n === '\r' && this.s[this.i] === '\n') this.i += 1;
        } else {
          this.i += 1; // a lone backslash is ignored
        }
        continue;
      }
      if (c === '(') nest += 1;
      if (c === ')') {
        if (nest === 0) {
          this.i += 1;
          return Buffer.from(out);
        }
        nest -= 1;
      }
      out.push(c.charCodeAt(0) & 255);
      this.i += 1;
    }
    throw new Error('unterminated literal string');
  }

  private numberOrRef(): number | PdfRef {
    const m = /^[+-]?(?:\d+\.?\d*|\.\d+)/.exec(this.s.substr(this.i, 32));
    if (!m) throw new Error('not a number');
    this.i += m[0].length;
    const n = Number(m[0]);
    // `12 0 R` — an indirect reference.
    const ref = /^\s+(\d+)\s+R(?![A-Za-z])/.exec(this.s.substr(this.i, 32));
    if (ref && Number.isInteger(n) && n >= 0) {
      this.i += ref[0].length;
      return { ref: n, gen: Number(ref[1]) };
    }
    return n;
  }
}
