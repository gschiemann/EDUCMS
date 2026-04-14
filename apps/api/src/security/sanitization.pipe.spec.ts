import { SanitizationPipe } from './sanitization.pipe';

describe('SanitizationPipe Security Properties', () => {
  let pipe: SanitizationPipe;

  beforeEach(() => {
    pipe = new SanitizationPipe();
  });

  describe('HTML Payload Injection Protection', () => {
    it('should sanitize raw strings containing malicious scripts', () => {
      const malicious = '<script>alert("xss")</script><b>Hello</b>';
      const result = pipe.transform(malicious, { type: 'body' });
      expect(result).not.toContain('<script>');
      expect(result).toContain('<b>Hello</b>');
    });

    it('should sanitize deeply nested object properties', () => {
      const payload = {
        title: 'Valid Title',
        metadata: {
          bio: '<img src=x onerror=alert(1)> and some text'
        }
      };
      
      const result = pipe.transform(payload, { type: 'body' });
      expect(result.metadata.bio).not.toContain('onerror=alert(1)');
      // sanitize-html will wipe the bad attrs but potentially leave the img or text
      expect(result.metadata.bio).toContain('and some text');
    });

    it('should preserve standard valid HTML structure defined in policy', () => {
      const validHTML = '<p>Normal text <b>bold</b> and <i>italic</i></p>';
      const result = pipe.transform(validHTML, { type: 'body' });
      expect(result).toEqual(validHTML);
    });
  });
});
