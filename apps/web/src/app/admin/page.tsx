import { redirect } from 'next/navigation';

// "/admin" is what people type for the owner console, which lives at /super.
// The console itself enforces SUPER_ADMIN (client gate + @RequireRoles on the API).
// Rendered per request so the CSP nonce gate never sees a prerendered route.
export const dynamic = 'force-dynamic';

export default function AdminRedirect() {
  redirect('/super');
}
