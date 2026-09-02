"use client";

/**
 * Settings Command Center — editor + context-rail primitives.
 *
 * Measurements come straight from the approved prototype
 * (scratch/design/settings-page/venueos-settings-command-center-v2.html),
 * with type sizes lifted to the production floor in handoff §17
 * (body ≥13px, helper 12px, group title 13–15px, editor title 17–20px).
 * Section dividers instead of a card around every group (§6.5).
 */
import type { ComponentType, ReactNode } from 'react';
import { GitBranch, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

type IconType = ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;

/** Editor identity row: 42px tinted icon + title + description + inheritance badge. */
export function EditorHead({
  icon: Icon,
  title,
  description,
  badge,
  className,
}: {
  icon?: IconType;
  title: string;
  description?: ReactNode;
  badge?: ReactNode;
  className?: string;
}) {
  return (
    // flex-wrap so a narrow editor column (mobile, §14) drops the inheritance
    // badge onto its own line instead of crushing the title to two words.
    <div className={cn('flex flex-wrap items-center gap-3 mb-[22px]', className)}>
      {Icon && (
        <span
          className="w-[42px] h-[42px] shrink-0 grid place-items-center rounded-xl"
          style={{ background: 'var(--brand-primary-soft)', color: 'var(--brand-primary)' }}
        >
          <Icon className="w-5 h-5" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1 basis-[220px]">
        <h2 className="text-[17px] leading-[22px] font-medium text-slate-900">{title}</h2>
        {description && <p className="mt-[3px] text-[13px] leading-[18px] text-slate-500">{description}</p>}
      </div>
      {badge}
    </div>
  );
}

export type InheritanceState = 'default' | 'inherited' | 'override' | 'unsupported';

/** §9.3 — one of four presentation states for an inheritable value. */
export function InheritanceBadge({ state, parentName }: { state: InheritanceState; parentName?: string }) {
  const label =
    state === 'default'
      ? 'Organization default'
      : state === 'inherited'
        ? `Inherited from ${parentName ?? 'organization'}`
        : state === 'override'
          ? 'Local override'
          : 'Not supported at this scope';
  const tone =
    state === 'override'
      ? 'bg-amber-50 text-amber-800'
      : state === 'unsupported'
        ? 'bg-slate-100 text-slate-500'
        : 'bg-sky-50 text-sky-800';
  return (
    <span className={cn('ml-auto inline-flex items-center gap-1.5 min-h-[30px] px-2.5 rounded-full text-[12px] font-medium whitespace-nowrap', tone)}>
      <GitBranch className="w-3.5 h-3.5" aria-hidden />
      {label}
    </span>
  );
}

/** One coherent field group. Divider-separated; no card. */
export function EditorSection({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn('py-[19px] border-t border-slate-200 first-of-type:pt-0 first-of-type:border-t-0 scroll-mt-24', className)}
      aria-labelledby={id ? `${id}-heading` : undefined}
    >
      <div className="flex items-start justify-between gap-4 mb-[13px]">
        <div className="min-w-0">
          <h3 id={id ? `${id}-heading` : undefined} className="text-[14px] leading-[19px] font-medium text-slate-900">
            {title}
          </h3>
          {description && <p className="mt-0.5 text-[12px] leading-[17px] text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Small outlined action used in section headings ("View usage"). */
export function SectionAction({ children, onClick, href, className }: { children: ReactNode; onClick?: () => void; href?: string; className?: string }) {
  const cls = cn(
    'inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg text-[12px] font-medium whitespace-nowrap border transition-colors',
    'hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
    className,
  );
  const style = { color: 'var(--brand-primary)', borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, white)' } as const;
  if (href) {
    return (
      <a href={href} className={cls} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

/** Context-rail module (§6.6): uppercase label, value line, helper copy, optional action. */
export function ContextModule({
  label,
  title,
  children,
  action,
  className,
}: {
  label: string;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-4 border-b border-slate-200 last:border-b-0 first:pt-0', className)}>
      <span className="block text-[11px] font-medium tracking-[.08em] uppercase text-slate-500">{label}</span>
      {title && <strong className="block mt-1.5 text-[13px] leading-[18px] font-medium text-slate-900">{title}</strong>}
      {children && <div className="mt-1 text-[12px] leading-[17px] text-slate-500">{children}</div>}
      {action}
    </div>
  );
}

/** Full-width outlined rail action ("Preview affected surfaces"). */
export function ContextAction({ children, onClick, href }: { children: ReactNode; onClick?: () => void; href?: string }) {
  const cls =
    'mt-2.5 w-full min-h-[36px] inline-flex items-center justify-center rounded-[9px] border text-[12px] font-medium hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';
  const style = { color: 'var(--brand-primary)', borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, white)' } as const;
  if (href) {
    return (
      <a href={href} className={cls} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

/** Scope path row inside a context module: "Organization → All locations". */
export function ScopePath({ from, to }: { from: ReactNode; to: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 mt-2 text-[12px] text-slate-600">
      <strong className="font-medium text-slate-900">{from}</strong>
      <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden />
      <span>{to}</span>
    </div>
  );
}

export type SettingsStatusKind =
  | 'ready'
  | 'connected'
  | 'attention'
  | 'degraded'
  | 'blocked'
  | 'notConfigured'
  | 'external'
  | 'planned'
  | 'unsupported'
  | 'unknown';

const STATUS_TONE: Record<SettingsStatusKind, string> = {
  ready: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  connected: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  attention: 'bg-amber-50 text-amber-800 border-amber-200',
  degraded: 'bg-amber-50 text-amber-900 border-amber-300',
  blocked: 'bg-red-50 text-red-800 border-red-200',
  notConfigured: 'bg-slate-50 text-slate-600 border-slate-200',
  external: 'bg-sky-50 text-sky-800 border-sky-200',
  planned: 'bg-slate-50 text-slate-500 border-slate-200',
  unsupported: 'bg-slate-50 text-slate-500 border-slate-200',
  unknown: 'bg-slate-100 text-slate-600 border-slate-300',
};

const STATUS_LABEL: Record<SettingsStatusKind, string> = {
  ready: 'Ready',
  connected: 'Connected',
  attention: 'Needs attention',
  degraded: 'Degraded',
  blocked: 'Blocked',
  notConfigured: 'Not configured',
  external: 'External device',
  planned: 'Planned',
  unsupported: 'Unsupported',
  unknown: 'Unknown',
};

/** §11 status vocabulary. Text always accompanies color (never color alone). */
export function StatusPill({ kind, label, className }: { kind: SettingsStatusKind; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center min-h-[24px] px-2 rounded-full border text-[12px] font-medium whitespace-nowrap', STATUS_TONE[kind], className)}>
      {label ?? STATUS_LABEL[kind]}
    </span>
  );
}

/** Selectable choice row (prototype `.sv-choice`): icon + title + helper + radio. */
export function ChoiceRow({
  icon: Icon,
  title,
  description,
  checked,
  name,
  value,
  onChange,
  disabled,
}: {
  icon?: IconType;
  title: string;
  description?: ReactNode;
  checked: boolean;
  name: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'grid grid-cols-[34px_minmax(0,1fr)_22px] items-center gap-2.5 min-h-[56px] px-2.5 py-2 rounded-[11px] border cursor-pointer transition-colors',
        checked ? 'border-transparent' : 'bg-slate-50/60 border-slate-200 hover:bg-slate-50',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
      style={checked ? { background: 'var(--brand-primary-soft)', borderColor: 'color-mix(in srgb, var(--brand-primary) 40%, white)' } : undefined}
      aria-current={checked ? 'true' : undefined}
    >
      <span className="w-[34px] h-[34px] grid place-items-center rounded-[9px] bg-slate-100 text-slate-600">
        {Icon ? <Icon className="w-4 h-4" aria-hidden /> : null}
      </span>
      <span className="min-w-0">
        <strong className="block text-[13px] font-medium text-slate-900">{title}</strong>
        {description && <span className="block mt-0.5 text-[12px] leading-[16px] text-slate-500">{description}</span>}
      </span>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="w-[15px] h-[15px] justify-self-center"
        style={{ accentColor: 'var(--brand-primary)' }}
      />
    </label>
  );
}

/** Editor-top error summary (§13.1 / §15). Focus it after a failed submit. */
export function ErrorSummary({ id, title, errors }: { id?: string; title?: string; errors: readonly { message: string; fieldId?: string }[] }) {
  if (!errors.length) return null;
  return (
    <div id={id} role="alert" tabIndex={-1} className="mb-5 rounded-[11px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300">
      <strong className="block font-medium">{title ?? 'Could not save'}</strong>
      <ul className="mt-1.5 space-y-1 list-disc pl-5">
        {errors.map((e, i) => (
          <li key={i}>
            {e.fieldId ? (
              <a href={`#${e.fieldId}`} className="underline underline-offset-2">
                {e.message}
              </a>
            ) : (
              e.message
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Editor-body skeleton that resembles the editor structure (§16), not a card stack. */
export function EditorSkeleton({ groups = 3 }: { groups?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <div className="flex items-center gap-3 mb-[22px]">
        <div className="w-[42px] h-[42px] rounded-xl bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-48 rounded bg-slate-100" />
          <div className="h-3 w-72 rounded bg-slate-100" />
        </div>
      </div>
      {Array.from({ length: groups }).map((_, i) => (
        <div key={i} className="py-[19px] border-t border-slate-200 first:border-t-0 first:pt-0 space-y-3">
          <div className="h-3.5 w-36 rounded bg-slate-100" />
          <div className="h-3 w-64 rounded bg-slate-100" />
          <div className="h-[42px] w-full rounded-[9px] bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** Permission page for a forbidden deep link (§10): names the category and who can grant access. */
export function PermissionDenied({ sectionLabel, grantedBy }: { sectionLabel: string; grantedBy?: string }) {
  return (
    <div className="rounded-[11px] border border-slate-200 bg-slate-50 px-5 py-6 text-center">
      <strong className="block text-[14px] font-medium text-slate-900">You don’t have access to {sectionLabel}</strong>
      <p className="mt-1.5 text-[13px] text-slate-500">
        {grantedBy ?? 'An organization administrator'} can grant access to this section.
      </p>
    </div>
  );
}
