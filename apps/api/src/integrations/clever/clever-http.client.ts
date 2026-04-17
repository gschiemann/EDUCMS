/**
 * Clever HTTP client abstraction.
 *
 * Interface separates OAuth + resource calls from transport so the service
 * can be unit tested with a mock client (see clever.service.spec.ts).
 *
 * NOTE: The real HTTP implementation below targets the documented Clever v3.1
 * endpoints (https://dev.clever.com/reference/api-overview). It has NOT been
 * exercised against a Clever sandbox — needs sandbox creds
 * (CLEVER_CLIENT_ID / CLEVER_CLIENT_SECRET) before production use.
 * Treat the response-shape mapping as provisional until validated.
 */
import { Injectable } from '@nestjs/common';

export interface CleverTokenResponse {
  access_token: string;
  token_type: string;
  scope?: string;
}

export interface CleverUser {
  id: string;
  email: string | null;
  name?: { first?: string; last?: string };
  role: string; // 'district_admin' | 'school_admin' | 'teacher' | 'staff' | 'student'
  district: string; // district id
  school?: string | null;
}

export interface CleverHttpClient {
  exchangeCode(code: string, redirectUri: string): Promise<CleverTokenResponse>;
  listUsers(accessToken: string): Promise<CleverUser[]>;
  getDistrictId(accessToken: string): Promise<string>;
}

/**
 * Real network implementation. NEEDS SANDBOX VALIDATION before production use.
 */
@Injectable()
export class RealCleverHttpClient implements CleverHttpClient {
  private readonly baseUrl = 'https://api.clever.com/v3.1';
  private readonly tokenUrl = 'https://clever.com/oauth/tokens';

  async exchangeCode(code: string, redirectUri: string): Promise<CleverTokenResponse> {
    const clientId = process.env.CLEVER_CLIENT_ID;
    const clientSecret = process.env.CLEVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('CLEVER_CLIENT_ID / CLEVER_CLIENT_SECRET not configured');
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      throw new Error(`Clever token exchange failed: ${res.status}`);
    }
    return (await res.json()) as CleverTokenResponse;
  }

  async getDistrictId(accessToken: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/districts`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Clever /districts failed: ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ data?: { id: string } }> };
    const id = body.data?.[0]?.data?.id;
    if (!id) throw new Error('Clever /districts returned no district');
    return id;
  }

  async listUsers(accessToken: string): Promise<CleverUser[]> {
    // Clever paginates; for scaffold we request first page of users (admins+teachers+staff).
    // Full pagination is a follow-up.
    const results: CleverUser[] = [];
    for (const roleSeg of ['admins', 'teachers', 'staff']) {
      const res = await fetch(`${this.baseUrl}/users?role=${roleSeg}&limit=1000`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) continue;
      const body = (await res.json()) as {
        data?: Array<{ data?: Partial<CleverUser> & { id: string; roles?: unknown } }>;
      };
      for (const row of body.data ?? []) {
        const d = row.data;
        if (!d?.id) continue;
        results.push({
          id: d.id,
          email: d.email ?? null,
          name: d.name,
          role: d.role ?? roleSeg.replace(/s$/, ''),
          district: d.district ?? '',
          school: d.school ?? null,
        });
      }
    }
    return results;
  }
}
