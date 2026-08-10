import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { ChevronRightIcon } from "@/components/Icons";

const links = [
  { href: "/assets", label: "Equipment & assets", desc: "Tractors, printers, trailers — profiles and maintenance" },
  { href: "/tax", label: "Tax Center", desc: "Year totals, flagged items, category breakdowns" },
  { href: "/search", label: "Search", desc: "Find any expense, receipt, or record in seconds" },
] as const;

export default function MorePage() {
  return (
    <div>
      <PageHeader title="More" />
      <Card className="divide-y divide-stone-100 p-0">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="flex items-center gap-3 px-4 py-3.5">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-stone-900">{l.label}</span>
              <span className="block text-sm text-stone-500">{l.desc}</span>
            </span>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
          </Link>
        ))}
        <a href="/api/export" className="flex items-center gap-3 px-4 py-3.5">
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-stone-900">Download backup</span>
            <span className="block text-sm text-stone-500">
              Full JSON export of every record — keep more than one copy
            </span>
          </span>
          <ChevronRightIcon className="h-5 w-5 shrink-0 text-stone-400" />
        </a>
      </Card>

      <Card className="mt-4">
        <h2 className="mb-1 font-semibold text-stone-900">Coming next</h2>
        <ul className="space-y-1 text-sm text-stone-500">
          <li>V2 — customers, quotes, invoices, payments, mileage, bank matching</li>
          <li>V3 — sheep profiles, lambing, health records, livestock sales</li>
          <li>V4 — print jobs, filament inventory, per-printer profitability</li>
        </ul>
        <p className="mt-2 text-xs text-stone-400">
          Full build spec lives in the repo: docs/SPEC.md
        </p>
      </Card>
    </div>
  );
}
