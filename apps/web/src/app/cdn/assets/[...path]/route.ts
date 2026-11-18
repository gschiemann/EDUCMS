/**
 * Same-origin asset caching proxy (Vercel edge). The behaviour — bucket lock,
 * path-segment validation, content-type allow-list and safety headers — is in
 * `../assetProxy.ts`, which documents why the route exists.
 */
import { proxy } from '../assetProxy';

export const runtime = 'edge';

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(req, ctx.params, false);
}

export async function HEAD(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  return proxy(req, ctx.params, true);
}
