import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as crypto from 'crypto';
import sanitizeHtml from 'sanitize-html';

@Injectable()
export class AssetSanitizerService {
  private readonly ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.mp4', '.webm', '.svg']);

  public isAllowedExtension(filename: string): boolean {
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    return this.ALLOWED_EXTENSIONS.has(ext);
  }

  public sanitizeSVG(svgContent: string): string {
    // Strip all script/event handler vectors from SVG content
    return sanitizeHtml(svgContent, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'svg', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline',
        'polygon', 'text', 'tspan', 'g', 'defs', 'use', 'image',
        'clipPath', 'mask', 'pattern', 'linearGradient', 'radialGradient', 'stop'
      ]),
      allowedAttributes: {
        '*': ['id', 'class', 'style', 'fill', 'stroke', 'stroke-width', 'transform',
              'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
              'd', 'viewBox', 'xmlns', 'points', 'x1', 'y1', 'x2', 'y2',
              'offset', 'stop-color', 'stop-opacity', 'opacity',
              'font-size', 'font-family', 'text-anchor', 'dominant-baseline'],
      },
      disallowedTagsMode: 'discard',
    });
  }

  public computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }

  public async processUpload(filePath: string, filename: string): Promise<{ sanitized: boolean, hash: string }> {
    if (!this.isAllowedExtension(filename)) {
      throw new BadRequestException(`Disallowed extension: ${filename}`);
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
