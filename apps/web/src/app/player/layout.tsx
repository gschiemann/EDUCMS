import type { Metadata, Viewport } from 'next';
import { AppDialogHost } from '@/components/ui/app-dialog';

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
      {/* Themed confirm/alert dialogs — replaces native window.confirm
          / alert so the player's settings overlay (Unpair Device, etc)
          stays inside the EduCMS visual language even on a kiosk where
          the OS chrome is hidden. */}
      <AppDialogHost />
    </div>
  );
}
