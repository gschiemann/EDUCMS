// Owner-session token, shared by middleware (Edge runtime) and the login
// action (Node runtime) — Web Crypto only, no Node imports.

export const SESSION_COOKIE = "to_owner";

export async function sessionTokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`${password}:twin-oaks-cookie-v1`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
