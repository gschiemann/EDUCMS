"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, ReceiptIcon, DollarIcon, GridIcon } from "./Icons";
import QuickAdd from "./QuickAdd";

const items = [
  { href: "/", label: "Home", icon: HomeIcon, exact: true },
  { href: "/receipts", label: "Receipts", icon: ReceiptIcon, exact: false },
  null, // center slot — Quick Add
  { href: "/expenses", label: "Money", icon: DollarIcon, exact: false, also: ["/income"] },
  { href: "/more", label: "More", icon: GridIcon, exact: false, also: ["/assets", "/tax", "/search", "/customers", "/invoices", "/mileage"] },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-sm">
      <div
        className="mx-auto grid max-w-2xl grid-cols-5 items-end px-2"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {items.map((item, i) => {
          if (item === null) {
            return <QuickAdd key={i} />;
          }
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href) ||
              ("also" in item && item.also?.some((a) => pathname.startsWith(a)));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                active ? "text-oak-700" : "text-stone-500"
              }`}
            >
              <Icon className="h-6 w-6" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
