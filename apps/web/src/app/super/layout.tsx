import { connection } from 'next/server';
import BusinessWorkspaceShell from '@/components/super/BusinessWorkspaceShell';

/** Every owner page needs the request nonce; prerendered flight scripts cannot carry it. */
export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return <BusinessWorkspaceShell>{children}</BusinessWorkspaceShell>;
}
