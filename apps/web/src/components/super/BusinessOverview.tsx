"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  Building2,
  CircleAlert,
  FileText,
  Monitor,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useCustomerList } from "@/hooks/use-customer-console";
import {
  DEFAULT_FILTERS,
  formatDate,
  type CustomerRow,
} from "@/lib/customer-console";

export function BusinessOverview({
  screens,
  online,
}: {
  screens?: number;
  online?: number;
}) {
  const t = useTranslations("businessConsole");
  const locale = useLocale();
  const business = useQuery<{
    revenue: { committedMonthlyCents: number };
    receivables: { overdueCents: number };
    profit: {
      monthlyCostCents: number;
      estimatedMonthlyProfitCents: number;
      marginPercent: number | null;
      coverage: "partial" | "complete";
    };
  }>({
    queryKey: ["super-business"],
    queryFn: () => apiFetch("/super/business"),
    staleTime: 30_000,
  });
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);
  const all = useCustomerList({
    ...DEFAULT_FILTERS,
    pageSize: 5,
    sort: "created",
    dir: "desc",
  });
  const overdue = useCustomerList({
    ...DEFAULT_FILTERS,
    pageSize: 5,
    status: "past_due",
  });
  const capacity = useCustomerList({
    ...DEFAULT_FILTERS,
    pageSize: 5,
    seats: "over",
  });
  const renewal = useCustomerList({
    ...DEFAULT_FILTERS,
    pageSize: 5,
    renewal: "due30",
  });
  const stats = [
    {
      label: "customers",
      value: all.data?.total,
      icon: Building2,
      href: "/super/customers",
      tone: "text-indigo-600 bg-indigo-50",
    },
    {
      label: "pastDue",
      value: overdue.data?.total,
      icon: FileText,
      href: "/super/customers?status=past_due",
      tone: "text-amber-700 bg-amber-50",
    },
    {
      label: "overCapacity",
      value: capacity.data?.total,
      icon: Monitor,
      href: "/super/customers?seats=over",
      tone: "text-rose-600 bg-rose-50",
    },
    {
      label: "renewing",
      value: renewal.data?.total,
      icon: ShieldCheck,
      href: "/super/customers?renewal=due30",
      tone: "text-emerald-700 bg-emerald-50",
    },
  ];
  const tasks: Array<{
    key: string;
    rows: CustomerRow[];
    error: boolean;
    href: string;
  }> = [
    {
      key: "paymentTasks",
      rows: overdue.data?.rows ?? [],
      error: overdue.isError,
      href: "/super/customers?status=past_due",
    },
    {
      key: "capacityTasks",
      rows: capacity.data?.rows ?? [],
      error: capacity.isError,
      href: "/super/customers?seats=over",
    },
    {
      key: "renewalTasks",
      rows: renewal.data?.rows ?? [],
      error: renewal.isError,
      href: "/super/customers?renewal=due30",
    },
  ];
  return (
    <section className="space-y-6" aria-labelledby="business-overview-title">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-indigo-600">
            {t("workspace")}
          </p>
          <h1
            id="business-overview-title"
            className="text-3xl font-semibold tracking-tight text-slate-950"
          >
            {t("welcome")}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
            {t("welcomeBody")}
          </p>
        </div>
        <Link
          href="/super/customers/new"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("newCustomer")}
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, href, tone }) => (
          <Link
            key={label}
            href={href}
            className="rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-indigo-300 sm:p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className={`rounded-xl p-2 ${tone}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <ArrowRight className="h-4 w-4 text-slate-300" aria-hidden />
            </div>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">
              {value ?? "—"}
            </p>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">{t(label)}</p>
          </Link>
        ))}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("profit")}</h2>
          <Link
            href="/super/profit"
            className="inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-indigo-700"
          >
            {t("viewProfit")}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {business.isError ? (
          <p role="alert" className="mt-3 text-sm text-rose-700">
            {t("loadFailed")}
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">{t("committedRevenue")}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {business.data
                  ? money(business.data.revenue.committedMonthlyCents)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">
                {t("estimatedContribution")}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {business.data
                  ? money(business.data.profit.estimatedMonthlyProfitCents)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("recordedCosts")}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {business.data
                  ? money(business.data.profit.monthlyCostCents)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">
                {t("overdueReceivables")}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-amber-700">
                {business.data
                  ? money(business.data.receivables.overdueCents)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t("margin")}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
                {business.data?.profit.marginPercent == null
                  ? "—"
                  : new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(business.data.profit.marginPercent) + "%"}
              </p>
            </div>
          </div>
        )}
        {business.data?.profit.coverage === "partial" ? (
          <p className="mt-4 inline-flex rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t("partialCosts")}
          </p>
        ) : null}
      </section>
      <Link
        href="/super/efficiency"
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5"
      >
        <span>
          <span className="block text-sm font-semibold">{t("efficiency")}</span>
          <span className="mt-1 block text-sm text-slate-500">
            {t("healthBody")}
          </span>
        </span>
        <span className="inline-flex items-center gap-3">
          <span className="text-sm font-medium tabular-nums text-slate-700">
            {screens == null || online == null ? t("loading") : t("onlineScreens", { online, total: screens })}
          </span>
          <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
        </span>
      </Link>
      <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
        <section className="rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 p-5">
            <h2 className="font-semibold">{t("attention")}</h2>
            <CircleAlert className="h-4 w-4 text-amber-600" aria-hidden />
          </div>
          <div className="divide-y divide-slate-100">
            {tasks.map((task) => (
              <div key={task.key} className="p-5">
                <div className="flex justify-between gap-2">
                  <h3 className="text-sm font-medium text-slate-700">
                    {t(task.key)}
                  </h3>
                  <Link
                    href={task.href}
                    className="text-xs font-semibold text-indigo-700"
                  >
                    {t("viewAll")}
                  </Link>
                </div>
                {task.error ? (
                  <p role="alert" className="mt-2 text-sm text-rose-700">
                    {t("loadFailed")}
                  </p>
                ) : task.rows.length ? (
                  <ul className="mt-2 space-y-1">
                    {task.rows.slice(0, 3).map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/super/customers/${c.id}`}
                          className="flex min-h-9 items-center justify-between gap-3 rounded-lg text-sm hover:text-indigo-700"
                        >
                          <span className="truncate">{c.name}</span>
                          <ArrowRight
                            className="h-4 w-4 shrink-0 text-slate-400"
                            aria-hidden
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">
                    {all.isLoading ? t("loading") : t("allClear")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">{t("recentCustomers")}</h2>
              <Link
                href="/super/customers"
                className="text-xs font-semibold text-indigo-700"
              >
                {t("viewAll")}
              </Link>
            </div>
            {all.isError ? (
              <p role="alert" className="mt-4 text-sm text-rose-700">
                {t("loadFailed")}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100">
                {all.data?.rows.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/super/customers/${c.id}`}
                      className="flex min-h-16 items-center gap-3 py-3"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-sm font-semibold text-slate-600">
                        {c.name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {c.name}
                        </span>
                        <span className="text-xs text-slate-400">
                          {formatDate(c.createdAt, locale)}
                        </span>
                      </span>
                      <ArrowRight
                        className="h-4 w-4 text-slate-400"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {!all.isLoading && !all.isError && !all.data?.rows.length ? (
              <p className="mt-4 text-sm text-slate-500">{t("noCustomers")}</p>
            ) : null}
          </section>
          <section className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
            <h2 className="font-semibold text-indigo-950">
              {t("businessAtHand")}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-indigo-900/70">
              {t("businessAtHandBody")}
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold text-indigo-700">
              <Link
                href="/super/invoices"
                className="inline-flex min-h-10 items-center gap-2"
              >
                {t("invoices")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/super/profit"
                className="inline-flex min-h-10 items-center gap-2"
              >
                {t("profit")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
