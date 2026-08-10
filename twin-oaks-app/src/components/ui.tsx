import Link from "next/link";
import type { ReactNode } from "react";

// Shared form control styles (forms are server-rendered; keep classes in one place).
export const inputCls =
  "w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-base text-stone-900 placeholder-stone-400 focus:border-oak-600 focus:outline-none focus:ring-2 focus:ring-oak-200";
export const labelCls = "mb-1 block text-sm font-medium text-stone-700";
export const btnPrimaryCls =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-oak-700 px-4 py-2.5 text-base font-semibold text-white shadow-sm active:bg-oak-800";
export const btnSecondaryCls =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-base font-medium text-stone-700 active:bg-stone-100";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  action,
  sub,
}: {
  title: string;
  action?: ReactNode;
  sub?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        {sub ? <p className="mt-0.5 text-sm text-stone-500">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

const chipTones: Record<string, string> = {
  green: "bg-oak-100 text-oak-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-800",
  stone: "bg-stone-200 text-stone-700",
  indigo: "bg-indigo-100 text-indigo-800",
};

export function Chip({ tone = "stone", children }: { tone?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${chipTones[tone] ?? chipTones.stone}`}
    >
      {children}
    </span>
  );
}

export function divisionTone(division: string): string {
  return division === "FARM" ? "green" : division === "TECH" ? "indigo" : "stone";
}

export function StatCard({
  label,
  value,
  sub,
  tone = "stone",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "stone" | "green" | "red";
}) {
  const valueCls =
    tone === "green" ? "text-oak-700" : tone === "red" ? "text-red-700" : "text-stone-900";
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${valueCls}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-stone-500">{sub}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  actionHref,
  actionLabel,
}: {
  title: string;
  hint?: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <Card className="py-10 text-center">
      <p className="font-medium text-stone-700">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">{hint}</p> : null}
      {actionHref && actionLabel ? (
        <Link href={actionHref} className={`${btnPrimaryCls} mt-4`}>
          {actionLabel}
        </Link>
      ) : null}
    </Card>
  );
}
