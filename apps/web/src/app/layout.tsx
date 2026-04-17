import type { Metadata } from 'next';
import { Inter, Fredoka, Caveat } from 'next/font/google';
import './globals.css';
import { TooltipProvider } from '@/components/ui/tooltip';
import Providers from '@/components/providers';

const inter = Inter({ subsets: ['latin'] });

// Rounded, friendly display font — used by playful template themes (e.g. Sunny Meadow).
// Exposed as a CSS variable so widget components can opt-in per theme.
const fredoka = Fredoka({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-fredoka',
  display: 'swap',
});

// Handwritten script — used for "teacher signatures", polaroid labels, doodle-style accents.
const caveat = Caveat({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-caveat',
  display: 'swap',
});

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
      <body className={`${inter.className} ${fredoka.variable} ${caveat.variable} min-h-screen bg-slate-50 text-slate-900 antialiased`} suppressHydrationWarning>
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
