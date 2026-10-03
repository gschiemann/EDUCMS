import {
  auditLine,
  auditTail,
  redactDiagnosticText,
} from './player-logs-redact';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXNjcmVlbiIsImtpbmQiOiJkZXZpY2UifQ.c2lnbmF0dXJlLWJ5dGVz';

describe('redactDiagnosticText', () => {
  it.each([
    [
      'a URL query and fragment',
      'GET https://a.example.com/v.mp4?token=s3cr3t#t=5 ok',
      'GET https://a.example.com/v.mp4?[redacted] ok',
    ],
    [
      'a fragment alone',
      'open https://a.example.com/#access_token=s3cr3t',
      'open https://a.example.com/#[redacted]',
    ],
    [
      'URL userinfo',
      'to wss://bob:pa55@rt.example.com/x',
      'to wss://[redacted]@rt.example.com/x',
    ],
    ['a whole JWT', `jwt ${JWT} end`, 'jwt [credential] end'],
    ['a truncated JWT', 'start eyJhbGciOiJIUzI1', 'start [credential]'],
    [
      'a bearer credential',
      'Authorization: Bearer abc.def-ghi',
      'Authorization: [redacted] [credential]',
    ],
    [
      'key=value pairs',
      'deviceToken=abc123 password: "hunter2" api-key=k1',
      'deviceToken=[redacted] password: "[redacted]" api-key=[redacted]',
    ],
    [
      'an opaque 40+ character run',
      `sig ${'A1b2'.repeat(12)} end`,
      'sig [redacted] end',
    ],
  ])('removes %s', (_name, input, expected) => {
    expect(redactDiagnosticText(input)).toBe(expected);
  });

  it.each([
    '2026-09-29T17:35:00Z ERROR PLAYER_RENDERER_TERMINATED slot=primary didCrash=false failures=1 retryMs=2000',
    'PLAYER_PROCESS_EXIT at=1727631300000 reason=6 status=0 pssKb=181234 rssKb=240112',
    'screen 4ad928a9-fd57-459b-a10a-f7da533e775e tokenStatus=valid requiresRePair=false',
    'https://api.example.com/api/v1/screens/heartbeat',
  ])('leaves ordinary diagnostics alone: %s', (line) => {
    expect(redactDiagnosticText(line)).toBe(line);
  });

  it('stays linear on a hostile line (no backtracking blow-up)', () => {
    const hostile =
      'a://'.repeat(3_000) +
      'eyJ'.repeat(1_000) +
      'token'.repeat(1_000) +
      'x.'.repeat(2_000);
    const started = Date.now();
    redactDiagnosticText(hostile);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('auditLine / auditTail bounds', () => {
  it('auditLine never returns more than its bound', () => {
    expect(auditLine('w '.repeat(5_000), 1024).length).toBeLessThanOrEqual(
      1024,
    );
  });

  it('auditTail keeps a short body whole (redacted)', () => {
    expect(auditTail('a\nhttps://x.example.com/?k=v', 10_240)).toBe(
      'a\nhttps://x.example.com/?[redacted]',
    );
  });

  it('auditTail never returns more than its bound', () => {
    expect(
      auditTail('line of text\n'.repeat(5_000), 10_240).length,
    ).toBeLessThanOrEqual(10_240);
  });

  it('a window that starts mid-token with no newline drops up to the first whitespace', () => {
    const raw = 'q=' + 'tok.en.'.repeat(2_000) + ' tail words';
    expect(auditTail(raw, 100)).toBe('tail words');
  });
});
