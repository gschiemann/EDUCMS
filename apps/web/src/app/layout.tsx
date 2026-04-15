import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import Providers from '@/components/providers';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Digital Signage CMS',
  description: 'Centralized school signage management.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} min-h-screen bg-slate-50 text-slate-900 antialiased`} suppressHydrationWarning>
        <Providers>
          <TooltipProvider>
            <main className="w-full min-h-screen relative flex flex-col">
              <div className="absolute top-0 inset-x-0 h-96 bg-gradient-to-b from-indigo-50 to-transparent pointer-events-none -z-10" />
              {children}
            </main>
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
