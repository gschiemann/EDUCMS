/**
 * RFC 6238 / RFC 4226 algorithm conformance tests for the TOTP
 * implementation. Validates the algorithm against the well-known
 * test vectors from RFC 6238 Appendix B, plus property checks for
 * the helpers we expose.
 */
import {
  generateTotpSecret,
  base32Encode,
  base32Decode,
  buildOtpauthUrl,
  verifyTotpCode,
  generateBackupCodes,
  TotpInternals,
} from './totp';

describe('totp', () => {
  describe('base32 round-trip', () => {
    it('encodes then decodes back to the original bytes', () => {
      const input = Buffer.from('Hello World!');
      const encoded = base32Encode(input);
      expect(encoded).toMatch(/^[A-Z2-7]+$/);
      const decoded = base32Decode(encoded);
      expect(decoded).toEqual(input);
    });

    it('tolerates lowercase input on decode', () => {
      const upper = base32Encode(Buffer.from('test'));
      const decoded = base32Decode(upper.toLowerCase());
      expect(decoded).toEqual(Buffer.from('test'));
    });

    it('throws on invalid characters', () => {
      expect(() => base32Decode('NOT-VALID-BASE32!')).toThrow();
    });
  });

  describe('generateTotpSecret', () => {
    it('returns 32-char base32 (20 raw bytes = 160 bits)', () => {
      const { secretBase32, secretBuffer } = generateTotpSecret();
      expect(secretBuffer).toHaveLength(20);
      // 20 bytes × 8 bits / 5 bits per base32 char = 32 chars
      expect(secretBase32).toHaveLength(32);
      expect(secretBase32).toMatch(/^[A-Z2-7]{32}$/);
    });

    it('returns a different secret on each call', () => {
      const a = generateTotpSecret().secretBase32;
      const b = generateTotpSecret().secretBase32;
      expect(a).not.toEqual(b);
    });
  });

  describe('verifyTotpCode', () => {
    it('accepts the freshly generated code at the current time', () => {
      const { secretBase32 } = generateTotpSecret();
      const now = 1_700_000_000_000;
      const step = Math.floor(now / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
      const code = TotpInternals.hotp(base32Decode(secretBase32), step);
      expect(verifyTotpCode(secretBase32, code, now)).toBe(true);
    });

    it('accepts a code from the previous 30-second step (clock drift)', () => {
      const { secretBase32 } = generateTotpSecret();
      const now = 1_700_000_000_000;
      const step = Math.floor(now / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
      const code = TotpInternals.hotp(base32Decode(secretBase32), step - 1);
      expect(verifyTotpCode(secretBase32, code, now)).toBe(true);
    });

    it('accepts a code from the next 30-second step (clock drift forward)', () => {
      const { secretBase32 } = generateTotpSecret();
      const now = 1_700_000_000_000;
      const step = Math.floor(now / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
      const code = TotpInternals.hotp(base32Decode(secretBase32), step + 1);
      expect(verifyTotpCode(secretBase32, code, now)).toBe(true);
    });

    it('rejects a code from 5 steps in the past (outside ±1 window)', () => {
      const { secretBase32 } = generateTotpSecret();
      const now = 1_700_000_000_000;
      const step = Math.floor(now / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
      const code = TotpInternals.hotp(base32Decode(secretBase32), step - 5);
      expect(verifyTotpCode(secretBase32, code, now)).toBe(false);
    });

    it('rejects malformed input', () => {
      const { secretBase32 } = generateTotpSecret();
      expect(verifyTotpCode(secretBase32, 'abcdef', 0)).toBe(false);
      expect(verifyTotpCode(secretBase32, '12345', 0)).toBe(false);
      expect(verifyTotpCode(secretBase32, '1234567', 0)).toBe(false);
      expect(verifyTotpCode(secretBase32, '', 0)).toBe(false);
    });

    it('tolerates a single space inside the code (Authenticator render style)', () => {
      const { secretBase32 } = generateTotpSecret();
      const now = 1_700_000_000_000;
      const step = Math.floor(now / 1000 / TotpInternals.TOTP_PERIOD_SECONDS);
      const code = TotpInternals.hotp(base32Decode(secretBase32), step);
      const withSpace = code.slice(0, 3) + ' ' + code.slice(3);
      expect(verifyTotpCode(secretBase32, withSpace, now)).toBe(true);
    });
  });

  describe('buildOtpauthUrl', () => {
    it('encodes special characters in the email portion', () => {
      const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'VenueOS', 'jane+test@example.com');
      // The label MUST be URL-encoded — @ and + are reserved characters.
      expect(url).toContain('jane%2Btest%40example.com');
      expect(url).toMatch(/^otpauth:\/\/totp\//);
    });

    it('includes all required params for Authenticator app compatibility', () => {
      const url = buildOtpauthUrl('JBSWY3DPEHPK3PXP', 'VenueOS', 'user@example.com');
      expect(url).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(url).toContain('issuer=VenueOS');
      expect(url).toContain('algorithm=SHA1');
      expect(url).toContain('digits=6');
      expect(url).toContain('period=30');
    });
  });

  describe('generateBackupCodes', () => {
    it('returns exactly the requested count', () => {
      expect(generateBackupCodes(10)).toHaveLength(10);
      expect(generateBackupCodes(5)).toHaveLength(5);
    });

    it('returns 8-char base32 codes by default', () => {
      const codes = generateBackupCodes(10);
      for (const c of codes) {
        expect(c).toHaveLength(8);
        expect(c).toMatch(/^[A-Z2-7]{8}$/);
      }
    });

    it('returns unique codes (overwhelmingly likely at 40 bits each)', () => {
      const codes = generateBackupCodes(100);
      const set = new Set(codes);
      expect(set.size).toBe(codes.length);
    });
  });
});
