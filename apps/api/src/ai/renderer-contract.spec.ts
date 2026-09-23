/**
 * DRIFT GUARD — renderer-contract.ts is apps/renderer/src/contract.ts, verbatim.
 *
 * The renderer's contract says the API may copy it whole (it has no imports) and
 * must refuse an answer whose `contractVersion` it does not recognise. The copy
 * lives here so the API image never pulls the renderer's module graph (puppeteer,
 * sharp, bundled fonts) next to emergency delivery. If the renderer's contract
 * changes, this goes red until the file is copied again — never hand-edit it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { RENDER_CONTRACT_VERSION, RENDER_LIMITS } from './renderer-contract';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');

describe("renderer-contract — the renderer's own wire contract, byte for byte", () => {
  it('is identical to apps/renderer/src/contract.ts', () => {
    const ours = fs.readFileSync(
      path.join(__dirname, 'renderer-contract.ts'),
      'utf8',
    );
    const theirs = fs.readFileSync(
      path.join(REPO, 'apps', 'renderer', 'src', 'contract.ts'),
      'utf8',
    );
    expect(ours).toBe(theirs);
  });

  it('carries the version the client pins and the body cap it plans around', () => {
    expect(RENDER_CONTRACT_VERSION).toBe(1);
    expect(RENDER_LIMITS.maxBodyBytes).toBe(4 * 1024 * 1024);
  });
});
