'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BrandMark } from './BrandMark';

/**
 * Public footer. Client component since 2026-10-22 so its labels follow the
 * reader's language (en / es / zh, `publicSite.footer.*`) like the rest of the
 * app; SSR renders English, the persisted locale applies after mount.
 */
export function Footer() {
  const t = useTranslations('publicSite.footer');
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[#070a14] border-t border-[#161e30]">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-5">
        <div className="md:col-span-1">
          <BrandMark tone="dark" />
          <p className="mt-4 text-sm text-slate-400 max-w-xs leading-relaxed">{t('tagline')}</p>
        </div>

        <FooterCol
          title={t('product')}
          links={[
            { href: '/', label: t('overview') },
            { href: '/#industries', label: t('industries') },
            { href: '/#templates', label: t('templates') },
            { href: '/pricing', label: t('pricing') },
          ]}
        />
        <FooterCol
          title={t('resources')}
          links={[
            { href: '/help', label: t('helpCenter') },
            { href: '/help/getting-started', label: t('gettingStarted') },
            { href: '/help/emergency-system', label: t('emergencySystem') },
            { href: '/help/sso', label: t('ssoSetup') },
            { href: '/help/api-and-webhooks', label: t('apiWebhooks') },
            { href: '/status', label: t('systemStatus') },
          ]}
        />
        <FooterCol
          title={t('trust')}
          links={[
            { href: '/help/it-security-overview', label: t('itSecurity') },
            { href: '/help/network-requirements', label: t('networkRequirements') },
            { href: '/security', label: t('reportVulnerability') },
            { href: '/dpa#subprocessors', label: t('subprocessors') },
          ]}
        />
        <FooterCol
          title={t('legal')}
          links={[
            { href: '/privacy', label: t('privacy') },
            { href: '/terms', label: t('terms') },
            { href: '/dpa', label: t('dpa') },
            { href: '/ferpa', label: t('ferpa') },
            { href: '/coppa', label: t('coppa') },
          ]}
        />
      </div>
      <div className="border-t border-[#161e30]">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 text-xs text-slate-500">
          <p>{t('copyright', { year: String(year) })}</p>
          <p>{t('strapline')}</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h4 className="text-xs font-semibold tracking-wider uppercase text-slate-300 mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="text-sm text-slate-400 hover:text-white transition">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
