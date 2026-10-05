/**
 * Can anyone open this PDF without a password? — the upload's test, against
 * real files made by pypdf for every security-handler revision in use, plus
 * the large corpus (the misc lane's PIL PDFs, reportlab's) when it is present.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { mentionsEncrypt, pdfOpenVerdict } from './pdf-encryption';

const FIXTURES = join(__dirname, '../../test/fixtures/pdf-pages');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));
const ALGOS = ['rc4-40', 'rc4-128', 'aes-128', 'aes-256-r5', 'aes-256'];

describe('pdfOpenVerdict — the empty user password, every revision', () => {
  it.each(ALGOS)('owner-password-only (%s) OPENS — anyone can view it', (algo) => {
    const file = fixture(`owner-only-${algo}.pdf`);
    expect(mentionsEncrypt(file)).toBe(true);
    expect(pdfOpenVerdict(file)).toEqual({ status: 'opens' });
  });

  it.each(ALGOS)('a user password (%s) NEEDS the password', (algo) => {
    expect(pdfOpenVerdict(fixture(`user-password-${algo}.pdf`)).status).toBe('needs-password');
  });

  it('an unencrypted PDF is not encrypted', () => {
    const file = fixture('three-pages.pdf');
    expect(mentionsEncrypt(file)).toBe(false);
    expect(pdfOpenVerdict(file)).toEqual({ status: 'not-encrypted' });
  });

  it('/EncryptMetadata alone is not an /Encrypt entry', () => {
    expect(mentionsEncrypt(Buffer.from('<< /EncryptMetadata false >>'))).toBe(false);
    expect(mentionsEncrypt(Buffer.from('trailer << /Encrypt 5 0 R >>'))).toBe(true);
    expect(mentionsEncrypt(Buffer.from('trailer<</Encrypt<</Filter/Standard>>>>'))).toBe(true);
  });

  it('a certificate-protected PDF (not the Standard handler) needs what nobody has', () => {
    const pdf = Buffer.from(
      '%PDF-1.7\n5 0 obj << /Filter /Adobe.PubSec /V 4 /R 4 >> endobj\ntrailer << /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n',
    );
    expect(pdfOpenVerdict(pdf)).toMatchObject({ status: 'needs-password' });
  });

  it.each([
    ['an /Encrypt pointing at nothing', '%PDF-1.7\ntrailer << /Encrypt 9 0 R >>\n%%EOF'],
    ['an encryption dictionary with no /U', '%PDF-1.7\n5 0 obj << /Filter /Standard /R 3 >> endobj\ntrailer << /Encrypt 5 0 R >>\n%%EOF'],
    ['garbage after /Encrypt', '%PDF-1.7\ntrailer << /Encrypt ))) >>\n%%EOF'],
    ['an unknown revision', '%PDF-1.7\n5 0 obj << /Filter /Standard /R 9 /U <00> >> endobj\ntrailer << /Encrypt 5 0 R >>\n%%EOF'],
  ])('%s is UNKNOWN — accepted as before, never refused on a guess', (_l, text) => {
    expect(pdfOpenVerdict(Buffer.from(text)).status).toBe('unknown');
  });

  it('reads literal strings with escapes the way a viewer does', () => {
    // The same RC4-40 owner-only file, with /O and /U rewritten as escaped literals.
    const src = fixture('owner-only-rc4-40.pdf').toString('latin1');
    const toLiteral = (hex: string) =>
      '(' +
      Buffer.from(hex, 'hex')
        .toString('latin1')
        .replace(/[\\()]/g, (c) => `\\${c}`)
        .replace(/[\x00-\x1f\x7f-\xff]/g, (c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`) +
      ')';
    const rewritten = src.replace(/\/([OU])\s*<([0-9a-fA-F\s]+)>/g, (_m, k, hex) => `/${k} ${toLiteral(hex.replace(/\s/g, ''))}`);
    expect(rewritten).not.toBe(src);
    expect(pdfOpenVerdict(Buffer.from(rewritten, 'latin1'))).toEqual({ status: 'opens' });
  });
});

const CORPUS = '/private/tmp/claude-501/-Users-gschiemann-Desktop-EDU-CMS/cafa1c28-d446-4a77-b079-0bb47d2a2ff5/scratchpad/pdfpages/corpus';
(existsSync(CORPUS) ? describe : describe.skip)('the local corpus (skipped where it is absent)', () => {
  it('owner-only files open, user-password files do not, plain files are not encrypted', () => {
    for (const name of readdirSync(CORPUS).filter((n) => n.endsWith('.pdf'))) {
      const v = pdfOpenVerdict(readFileSync(join(CORPUS, name))).status;
      const want = name.startsWith('enc_owner_only') ? 'opens' : name.startsWith('enc_user_pw') ? 'needs-password' : 'not-encrypted';
      expect([name, v]).toEqual([name, want]);
    }
  });
});
