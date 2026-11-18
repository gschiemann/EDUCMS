'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, KeyRound } from 'lucide-react';

/**
 * Shows a newly issued custom-webhook secret exactly once, right after the
 * connection is created. The server generates the secret and never returns
 * it again, so this panel is the operator's only chance to copy it.
 * Mounted by ConnectModal in ./page.tsx.
 */
export function WebhookSecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useTranslations();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the
      // value stays selectable in the field below.
    }
  };

  return (
    <div className="space-y-3" data-testid="webhook-secret-reveal">
      <p className="font-bold text-slate-800 flex items-center gap-1.5">
        <KeyRound className="w-4 h-4" /> {t('billingCommerce.webhookSecretIssuedTitle')}
      </p>
      <p className="text-xs text-slate-600">{t('billingCommerce.webhookSecretIssuedBody')}</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={secret}
          aria-label={t('billingCommerce.webhookSecretIssuedTitle')}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 bg-slate-50"
        />
        <button
          type="button"
          onClick={copy}
          className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-200 hover:bg-slate-50 inline-flex items-center gap-1"
        >
          <Copy className="w-3 h-3" />
          {copied ? t('billingCommerce.webhookSecretCopied') : t('billingCommerce.webhookSecretCopy')}
        </button>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-2 text-sm font-bold rounded-lg bg-amber-600 text-white hover:bg-amber-700"
        >
          {t('billingCommerce.webhookSecretSavedDone')}
        </button>
      </div>
    </div>
  );
}
