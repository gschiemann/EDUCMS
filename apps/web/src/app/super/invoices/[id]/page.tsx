"use client";

import Link from "next/link";
import { useBusinessHydrated } from "@/hooks/use-customer-console";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { useInvoiceDocument } from "@/hooks/use-customer-console";
import { formatDate } from "@/lib/customer-console";

export default function InvoiceDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("businessConsole");
  const tc = useTranslations("customerConsole");
  const locale = useLocale();
  const user = useAppStore((s) => s.user);
  const mounted = useBusinessHydrated();
  const customerId = mounted
    ? (new URLSearchParams(window.location.search).get("customer") ?? "")
    : "";
  const document = useInvoiceDocument(
    user?.role === "SUPER_ADMIN" && mounted ? customerId : "",
    id,
  );
  const d = document.data;
  const money = (cents: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency: d?.invoice.currency ?? "usd",
    }).format(cents / 100);
  if (!mounted) return null;
  if (user?.role !== "SUPER_ADMIN")
    return <p className="p-6">{t("restricted")}</p>;
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 py-6 sm:p-8">
      <style>{`@media print { body > * { visibility: hidden; } #invoice-print, #invoice-print * { visibility: visible; } #invoice-print { position: absolute; top: 0; left: 0; width: 100%; border: 0; box-shadow: none; } .invoice-no-print { display: none; } }`}</style>
      <div className="invoice-no-print flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/super/invoices"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-slate-600"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {t("invoices")}
        </Link>
        <button
          onClick={() => window.print()}
          disabled={!d}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          <Printer className="h-4 w-4" aria-hidden />
          {t("printInvoice")}
        </button>
      </div>
      {document.isError || !customerId ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700"
        >
          {t("documentFailed")}
        </p>
      ) : !d ? (
        <Loader2
          className="mx-auto my-12 h-6 w-6 animate-spin text-indigo-600"
          aria-label={t("loading")}
        />
      ) : (
        <article
          id="invoice-print"
          className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-12"
        >
          <header className="flex flex-wrap justify-between gap-6 border-b border-slate-200 pb-8">
            <div>
              <p className="text-xl font-semibold text-indigo-600">
                {d.seller.name}
              </p>
              <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-slate-400">
                {t("billTo")}
              </p>
              <h2 className="mt-2 text-lg font-semibold">{d.customer.name}</h2>
            </div>
            <div className="sm:text-right">
              <h1 className="text-3xl font-semibold tracking-tight">
                {t("invoiceDocument")}
              </h1>
              <p className="mt-2 text-sm text-slate-500">{d.invoice.number}</p>
              <p className="mt-3 text-xs text-slate-500">
                {tc(`detail.invoiceStatus.${d.invoice.status}`)}
              </p>
            </div>
          </header>
          <dl className="grid grid-cols-2 gap-6 py-7 sm:grid-cols-3">
            {[
              [tc("detail.sent"), formatDate(d.invoice.sentAt, locale)],
              [tc("detail.due"), formatDate(d.invoice.dueAt, locale)],
              [tc("detail.poNumber"), d.invoice.poNumber ?? "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-400">{label}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {d.invoice.periodStart || d.invoice.periodEnd ? (
            <p className="mb-5 text-xs text-slate-500">
              {t("servicePeriod")}: {formatDate(d.invoice.periodStart, locale)}{" "}
              – {formatDate(d.invoice.periodEnd, locale)}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-3">{t("description")}</th>
                  <th className="px-3 py-3 text-right">{t("quantity")}</th>
                  <th className="px-3 py-3 text-right">{t("unitPrice")}</th>
                  <th className="px-3 py-3 text-right">
                    {tc("detail.amount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((line, index) => (
                  <tr key={index} className="border-b border-slate-100">
                    <td className="px-3 py-5">{line.description}</td>
                    <td className="px-3 py-5 text-right tabular-nums">
                      {line.quantity}
                    </td>
                    <td className="px-3 py-5 text-right tabular-nums">
                      {money(line.unitAmountCents)}
                    </td>
                    <td className="px-3 py-5 text-right tabular-nums">
                      {money(line.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-8 flex justify-end">
            <div className="min-w-56 border-t-2 border-indigo-600 pt-4">
              <p className="flex justify-between gap-8 text-sm">
                <span>{t("total")}</span>
                <strong className="text-xl tabular-nums">
                  {money(d.invoice.amountCents)}
                </strong>
              </p>
            </div>
          </div>
          {d.invoice.notes ? (
            <p className="mt-10 whitespace-pre-wrap text-sm leading-relaxed text-slate-500">
              {d.invoice.notes}
            </p>
          ) : null}
        </article>
      )}
    </div>
  );
}
