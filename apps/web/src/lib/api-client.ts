import { useUIStore } from '@/store/ui-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

/**
 * Shared fetch wrapper that automatically attaches the JWT bearer token.
 * Throws on non-2xx responses with the error message from the API.
 */
export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useUIStore.getState().token;
  
  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    // Token expired or invalid — force logout
    useUIStore.getState().logout();
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error: ${res.status}`);
  }

  return res.json();
}
