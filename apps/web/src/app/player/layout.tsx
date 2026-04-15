import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'EDU CMS Player',
  description: 'Digital signage player for screens',
  manifest: '/player/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function PlayerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black overflow-hidden">
      {children}
    </div>
  );
}
