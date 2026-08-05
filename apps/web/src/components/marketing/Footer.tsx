import Link from 'next/link';
import { BrandMark } from './BrandMark';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-[#070a14] border-t border-[#161e30]">
      <div className="max-w-6xl mx-auto px-6 py-14 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-1">
          <BrandMark tone="dark" />
          <p className="mt-4 text-sm text-slate-400 max-w-xs leading-relaxed">
            One platform for digital signage, kiosks, live scoreboards, and
            emergency alerts — across every venue you run.
          </p>
        </div>

        <FooterCol
          title="Product"
          links={[
            { href: '/', label: 'Overview' },
            { href: '/#industries', label: 'Industries' },
            { href: '/#templates', label: 'Templates' },
            { href: '/pricing', label: 'Pricing' },
          ]}
        />
        <FooterCol
          title="Resources"
          links={[
            { href: '/help', label: 'Help center' },
            { href: '/help/getting-started', label: 'Getting started' },
            { href: '/help/emergency-system', label: 'Emergency system' },
            { href: '/help/sso', label: 'SSO setup' },
            { href: '/status', label: 'System status' },
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
      <div className="border-t border-[#161e30]">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 text-xs text-slate-500">
          <p>&copy; {year} VenueOS — one platform for every venue.</p>
          <p>Digital signage · interactive kiosks · live scoreboards · emergency alerts</p>
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
