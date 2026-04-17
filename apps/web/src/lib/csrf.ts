const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

let csrfTokenCache: string | null = null;
let pending: Promise<string> | null = null;

export async function ensureCsrfToken(): Promise<string> {
  if (csrfTokenCache) return csrfTokenCache;
  if (pending) return pending;

  pending = (async () => {
    try {
      const res = await fetch(`${API_URL}/security/csrf`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`CSRF bootstrap failed: ${res.status}`);
      const body = (await res.json()) as { token?: string };
      if (!body.token) throw new Error('CSRF bootstrap returned empty token');
      csrfTokenCache = body.token;
      return csrfTokenCache;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

export function invalidateCsrfToken(): void {
  csrfTokenCache = null;
}
