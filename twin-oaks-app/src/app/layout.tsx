import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import BottomNav from "@/components/BottomNav";
import { SearchIcon } from "@/components/Icons";

export const metadata: Metadata = {
  title: "Twin Oaks OS",
  description:
    "The business operating system for Twin Oaks Farm & Tech LLC — receipts, expenses, equipment, and tax-ready records.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#2f5233",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-stone-100 text-stone-900 antialiased">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
          <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-oak-700 text-sm font-bold text-white">
                TO
              </span>
              <span className="text-lg font-bold tracking-tight text-oak-800">
                Twin Oaks <span className="font-normal text-stone-500">OS</span>
              </span>
            </Link>
            <Link
              href="/search"
              aria-label="Search"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-stone-600 active:bg-stone-100"
            >
              <SearchIcon className="h-5 w-5" />
            </Link>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-4 pt-4 pb-32">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
