import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-24 border-t border-slate-200/80 bg-white/60 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-1">
          <BrandMark />
          <p className="mt-4 text-sm text-slate-600 max-w-xs leading-relaxed">
            Made for K-12 schools. Secure digital signage, emergency alerts, and classroom displays — all in one place.
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            { href: '/', label: 'Overview' },
            { href: '/#features', label: 'Features' },
            { href: '/pricing', label: 'Pricing' },
            { href: '/login', label: 'Sign in' },
          ]}
        />
        <FooterCol
          title="Resources"
          links={[
            { href: '/help', label: 'Help center' },
            { href: '/help/getting-started', label: 'Getting started' },
            { href: '/help/emergency-system', label: 'Emergency system' },
            { href: '/help/sso', label: 'SSO setup' },
          ]}
        />
        <FooterCol
          title="Legal"
          links={[
            { href: '/privacy', label: 'Privacy policy' },
            { href: '/terms', label: 'Terms of service' },
            { href: '/ferpa', label: 'FERPA' },
            { href: '/coppa', label: 'COPPA' },
          ]}
        />
      </div>
      <div className="border-t border-slate-200/60">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs text-slate-500">
          <p>&copy; {year} EduSignage. Built for K-12 schools.</p>
          <p className="italic">Review with your district&apos;s legal counsel before adoption.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h4 className="text-xs font-bold tracking-wider uppercase text-slate-900 mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.href + l.label}>
            <Link href={l.href} className="text-sm text-slate-600 hover:text-indigo-600 transition">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
