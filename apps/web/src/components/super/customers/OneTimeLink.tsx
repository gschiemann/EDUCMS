"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/customer-console";
import { Check, Copy } from "lucide-react";
const INPUT =
  "w-full min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900";
const BTN =
  "inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg text-sm font-semibold";
/** The single-use owner link, shown once, with a copy button that says whether it copied. */
export function OneTimeLink({
  url,
  expiresAt,
}: {
  url: string;
  expiresAt: string;
}) {
  const t = useTranslations("customerConsole");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div
      className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3"
      data-testid="one-time-link"
    >
      <p className="text-sm font-semibold text-indigo-900">
        {t("detail.linkReady")}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${INPUT} font-mono text-xs`}
          aria-label={t("detail.linkReady")}
        />
        <button
          type="button"
          onClick={copy}
          className={`${BTN} bg-indigo-600 text-white shrink-0`}
        >
          {copied ? (
            <Check className="w-4 h-4" aria-hidden />
          ) : (
            <Copy className="w-4 h-4" aria-hidden />
          )}
          {copied ? t("detail.copied") : t("detail.copy")}
        </button>
      </div>
      <p className="text-xs text-indigo-900/80 mt-2">
        {t("detail.linkSingleUse", { date: formatDate(expiresAt, locale) })}
      </p>
    </div>
  );
}
