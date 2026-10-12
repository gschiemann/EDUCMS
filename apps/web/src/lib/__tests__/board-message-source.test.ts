/**
 * H-9 (launch security re-audit, 2026-10-11) — editor `message` listeners
 * accept only frames in this document (or this window's own replay).
 */
import { isFromDocumentFrame } from '../board-message-source';

describe('isFromDocumentFrame', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('accepts a message from an iframe mounted in this document', () => {
    const f = document.createElement('iframe');
    document.body.appendChild(f);
    const ev = new MessageEvent('message', { data: { type: 'educms-field-click' }, source: f.contentWindow as Window });
    expect(isFromDocumentFrame(ev)).toBe(true);
  });

  it("accepts this window's own replay", () => {
    expect(isFromDocumentFrame(new MessageEvent('message', { data: {}, source: window }))).toBe(true);
  });

  it('refuses another window (popup / opener / a frame that is not ours) and a missing source', () => {
    const other = document.createElement('iframe');
    document.body.appendChild(other);
    const foreign = other.contentWindow as Window;
    other.remove(); // no longer one of OUR frames
    expect(isFromDocumentFrame(new MessageEvent('message', { data: {}, source: foreign }))).toBe(false);
    expect(isFromDocumentFrame(new MessageEvent('message', { data: {} }))).toBe(false);
  });

  it('honours a narrower selector', () => {
    const f = document.createElement('iframe');
    f.title = 'Something else';
    document.body.appendChild(f);
    const ev = new MessageEvent('message', { data: {}, source: f.contentWindow as Window });
    expect(isFromDocumentFrame(ev, 'iframe[title="Signage template"]')).toBe(false);
  });
});
