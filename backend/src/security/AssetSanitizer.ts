import fs from 'fs';
import crypto from 'crypto';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * ASP: Asset Sanitization Pipeline
 * Mitigates Unsafe Asset Rendering (Release Blocker RT-02).
 */

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

// Allowed file extensions
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.mp4', '.webm', '.svg']);

export class AssetSanitizer {
  
  /**
   * Validates if a file extension is allowed.
   */
  public static isAllowedExtension(filename: string): boolean {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
  }

  /**
   * Processes an SVG string, stripping out all executable vectors (<script>, on*, etc).
   */
  public static sanitizeSVG(svgContent: string): string {
    return DOMPurify.sanitize(svgContent, {
      USE_PROFILES: { svg: true },
      FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'style'],
      FORBID_ATTR: ['onload', 'onclick', 'onmouseover', 'onerror', 'href'] 
    });
  }

  /**
   * Computes the SHA-256 hash of a file for integrity checking on devices.
   */
  public static computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }
  
  /**
   * Pipeline simulator: Validates extension, cleans SVG if needed, and returns the hash.
   */
  public static async processUpload(filePath: string, filename: string): Promise<{ sanitized: boolean, hash: string }> {
    if (!this.isAllowedExtension(filename)) {
      throw new Error(`Execution Vector Blocked: Disallowed extension ${filename}`);
    }

    if (filename.toLowerCase().endsWith('.svg')) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const cleanSvg = this.sanitizeSVG(content);
      fs.writeFileSync(filePath, cleanSvg, 'utf-8');
    }

    const hash = await this.computeFileHash(filePath);
    return { sanitized: true, hash };
  }
}
