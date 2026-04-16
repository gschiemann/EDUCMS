import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'EMERGENCY TRG',
  description: 'Emergency facility broadcast override',
  manifest: '/manifest-panic.json',
  appleWebApp: {
    capable: true,
    title: 'EMERGENCY',
    statusBarStyle: 'black-translucent',
  },
};

export default function PanicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
