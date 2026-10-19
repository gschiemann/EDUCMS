"use client";

import Link from "next/link";
import { useState } from "react";
import { FileDown, FileUp, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useInvoiceAttachment } from "@/hooks/use-customer-console";
import { apiFetch } from "@/lib/api-client";
import type { CustomerInvoiceView } from "@/lib/customer-console";

export function InvoiceActions({
  customerId,
  invoice,
}: {
  customerId: string;
  invoice: CustomerInvoiceView;
}) {
  const t = useTranslations("businessConsole");
  const upload = useInvoiceAttachment(customerId);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-normal">
      <Link
        href={`/super/invoices/${invoice.id}?customer=${encodeURIComponent(customerId)}`}
        className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-indigo-700"
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden />
        {t("invoiceDocument")}
      </Link>
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-1 text-xs font-medium text-indigo-700">
        {upload.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <FileUp className="h-3.5 w-3.5" aria-hidden />
        )}
        {t("uploadPdf")}
        <input
          type="file"
          accept="application/pdf,.pdf"
          aria-label={t("uploadFor", { number: invoice.number })}
          className="sr-only"
          disabled={upload.isPending}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setError("");
            if (
              file.size > 10 * 1024 * 1024 ||
              !file.name.toLowerCase().endsWith(".pdf")
            ) {
              setError(t("pdfLimit"));
              return;
            }
            try {
              await upload.mutateAsync({ invoiceId: invoice.id, file });
            } catch (err) {
              setError(err instanceof Error ? err.message : t("saveFailed"));
            }
          }}
        />
      </label>
      {invoice.attachment ? (
        <button
          type="button"
          disabled={opening}
          className="min-h-9 text-xs font-medium text-indigo-700 underline"
          onClick={async () => {
            setOpening(true);
            setError("");
            try {
              const result = await apiFetch<{ url: string }>(
                `/super/customers/${customerId}/invoices/${invoice.id}/pdf`,
              );
              const url = new URL(result.url);
              if (url.protocol !== "https:" && url.protocol !== "http:")
                throw new Error(t("saveFailed"));
              // The API signs with download:fileName, so Content-Disposition keeps this workspace open.
              // Same-window navigation does not depend on Safari's transient popup permission.
              window.location.assign(url.toString());
            } catch (err) {
              setError(err instanceof Error ? err.message : t("saveFailed"));
            } finally {
              setOpening(false);
            }
          }}
        >
          {invoice.attachment.fileName}
        </button>
      ) : null}
      {upload.isSuccess ? (
        <span role="status" className="text-xs text-emerald-700">
          {t("uploaded")}
        </span>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-xs text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
