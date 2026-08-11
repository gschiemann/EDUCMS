"use client";

import Link from "next/link";
import { useState } from "react";
import { CameraIcon, DollarIcon, GridIcon, PlusIcon, ReceiptIcon, TractorIcon, WrenchIcon } from "./Icons";

// SPEC §2: one large quick-add button for the records used every day.
// Only actions that actually exist are listed — nothing fake.
const actions = [
  { href: "/receipts/new", label: "Receipt", desc: "Snap or upload — categorize later", icon: CameraIcon },
  { href: "/expenses/new", label: "Expense", desc: "Record money going out", icon: ReceiptIcon },
  { href: "/income/new", label: "Income", desc: "Record money coming in", icon: DollarIcon },
  { href: "/invoices/new", label: "Invoice", desc: "Bill a customer", icon: GridIcon },
  { href: "/mileage", label: "Mileage", desc: "Log a business trip", icon: TractorIcon },
  { href: "/assets", label: "Maintenance", desc: "Log service on a machine", icon: WrenchIcon },
];

export default function QuickAdd() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-center">
      <button
        type="button"
        aria-label="Quick add"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="relative -top-4 flex h-14 w-14 items-center justify-center rounded-full bg-oak-700 text-white shadow-lg shadow-oak-700/30 active:bg-oak-800"
      >
        <PlusIcon className={`h-7 w-7 transition-transform ${open ? "rotate-45" : ""}`} />
      </button>

      {open ? (
        <>
          <div
            className="fixed top-0 right-0 bottom-0 left-0 z-40 bg-stone-900/40"
            onClick={() => setOpen(false)}
          />
          <div className="fixed bottom-24 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 border-b border-stone-100 px-4 py-3.5 last:border-b-0 active:bg-stone-50"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-oak-100 text-oak-700">
                  <a.icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold text-stone-900">{a.label}</span>
                  <span className="block text-xs text-stone-500">{a.desc}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
