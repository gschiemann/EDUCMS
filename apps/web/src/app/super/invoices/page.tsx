"use client";

import Link from "next/link";
import { useBusinessHydrated } from "@/hooks/use-customer-console";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, Loader2, Plus, Search } from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  useBusinessInvoices,
  useCustomerDetail,
  useCustomerList,
} from "@/hooks/use-customer-console";
import {
  DEFAULT_FILTERS,
  formatDate,
  INVOICE_STATUSES,
  type InvoiceListResponse,
} from "@/lib/customer-console";
import { InvoicesCard } from "@/components/super/customers/CustomerDetailView";
import { InvoiceActions } from "@/components/super/customers/InvoiceActions";

export default function InvoicesPage() {
  const t = useTranslations("businessConsole");
  const tc = useTranslations("customerConsole");
  const locale = useLocale();
  const user = useAppStore((s) => s.user);
  const mounted = useBusinessHydrated();
  const owner = mounted && user?.role === "SUPER_ADMIN";
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [customer, setCustomer] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const timer = setTimeout(() => setCustomerQ(customerSearch), 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);
  const invoices = useBusinessInvoices({ q, status, page }, owner);
  const customers = useCustomerList(
    { ...DEFAULT_FILTERS, q: customerQ, pageSize: 25 },
    owner && createOpen,
  );
  const detail = useCustomerDetail(customer, owner && createOpen);
  if (!mounted) return null;
  if (!owner)
    return (
      <p role="alert" className="p-6">
        {t("restricted")}
      </p>
    );
  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 py-6 sm:p-6">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-indigo-600">
            {t("workspace")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("invoices")}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            {t("invoicesBody")}
          </p>
        </div>
        <button
          onClick={() => setCreateOpen((v) => !v)}
          aria-expanded={createOpen}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("newInvoice")}
        </button>
      </header>
      {createOpen ? (
        <section className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4">
          <h2 className="font-semibold">{t("chooseInvoiceCustomer")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">
              {t("findCustomer")}
              <input
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                type="search"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              {t("customers")}
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              >
                <option value="">{t("chooseCustomer")}</option>
                {customers.data?.rows
                  .filter(
                    (c) =>
                      c.billingMode === "INVOICE" ||
                      c.billingMode === "PURCHASE_ORDER",
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {customers.isError || detail.isError ? (
            <p role="alert" className="text-sm text-rose-700">
              {t("loadFailed")}
            </p>
          ) : null}
          {detail.isLoading ? (
            <Loader2
              className="h-5 w-5 animate-spin"
              aria-label={t("loading")}
            />
          ) : detail.data ? (
            <InvoicesCard key={detail.data.id} c={detail.data} />
          ) : (
            <p className="text-xs text-slate-500">{t("invoiceCustomerHint")}</p>
          )}
        </section>
      ) : null}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">{t("searchInvoices")}</span>
            <Search
              className="absolute left-3 top-3.5 h-4 w-4 text-slate-400"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("searchInvoices")}
              className="min-h-11 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm"
            />
          </label>
          <select
            aria-label={t("invoiceStatus")}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">{t("allInvoiceStatuses")}</option>
            {INVOICE_STATUSES.map((s) => (
              <option value={s} key={s}>
                {tc(`detail.invoiceStatus.${s}`)}
              </option>
            ))}
          </select>
        </div>
        {invoices.isError ? (
          <p role="alert" className="p-6 text-sm text-rose-700">
            {t("loadFailed")}
          </p>
        ) : !invoices.data ? (
          <div className="p-10">
            <Loader2
              className="mx-auto h-6 w-6 animate-spin text-indigo-600"
              aria-label={t("loading")}
            />
          </div>
        ) : invoices.data.rows.length ? (
          <div className="divide-y divide-slate-100">
            {invoices.data.rows.map((invoice) => (
              <InvoiceRow key={invoice.id} invoice={invoice} locale={locale} />
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <FileText className="mx-auto h-9 w-9 text-slate-300" aria-hidden />
            <p className="mt-3 text-sm text-slate-500">{t("noInvoices")}</p>
          </div>
        )}
        {invoices.data && invoices.data.pages > 1 ? (
          <nav
            className="flex items-center justify-between border-t border-slate-100 p-4"
            aria-label={t("invoicePages")}
          >
            <button
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {tc("prev")}
            </button>
            <span className="text-xs text-slate-500">
              {tc("pageOf", { page, pages: invoices.data.pages })}
            </span>
            <button
              className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm disabled:opacity-40"
              disabled={page >= invoices.data.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              {tc("next")}
            </button>
          </nav>
        ) : null}
      </section>
    </div>
  );
}
function InvoiceRow({
  invoice,
  locale,
}: {
  invoice: InvoiceListResponse["rows"][number];
  locale: string;
}) {
  const tc = useTranslations("customerConsole");
  return (
    <article className="flex flex-col justify-between gap-3 p-5 sm:flex-row">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{invoice.number}</p>
        <Link
          href={`/super/customers/${invoice.customerId}`}
          className="mt-1 inline-block text-sm text-indigo-700"
        >
          {invoice.customerName}
        </Link>
        <InvoiceActions customerId={invoice.customerId} invoice={invoice} />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-6 sm:block sm:text-right">
        <p className="text-lg font-semibold tabular-nums">
          {new Intl.NumberFormat(locale, {
            style: "currency",
            currency: invoice.currency,
          }).format(invoice.amountCents / 100)}
        </p>
        <p
          className={`mt-1 text-xs ${invoice.overdue ? "font-semibold text-amber-700" : "text-slate-500"}`}
        >
          {tc(`detail.invoiceStatus.${invoice.status}`)} · {tc("detail.due")}{" "}
          {formatDate(invoice.dueAt, locale)}
        </p>
      </div>
    </article>
  );
}
