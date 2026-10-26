"use client";

import {
  AlertTriangle, Ban, Building2, CheckCircle2, Clock3, CreditCard, FileUp, FolderInput, HardDrive,
  KeyRound, LayoutTemplate, LifeBuoy, Link2, ListVideo, LogIn, Map as MapIcon, Megaphone, MessageSquare,
  Monitor, Palette, PauseCircle, PencilLine, PlayCircle, Plug, Power, RefreshCw, RotateCw, Send,
  Settings2, ShieldCheck, ShieldHalf, Siren, Sparkles, Trash2, Trophy, Upload, UserCheck, UserCog,
  UserMinus, UserPlus, UtensilsCrossed,
} from 'lucide-react';
import type { ComponentType, CSSProperties } from 'react';
import type { ActivityIcon as IconName, ActivityTone } from '@/lib/activity/activityFeed';

const ICONS: Record<IconName, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  playlist: ListVideo,
  publish: Send,
  pause: PauseCircle,
  play: PlayCircle,
  upload: Upload,
  trash: Trash2,
  approve: CheckCircle2,
  reject: Ban,
  template: LayoutTemplate,
  import: FileUp,
  ai: Sparkles,
  usb: HardDrive,
  screen: Monitor,
  pair: Link2,
  rename: PencilLine,
  move: FolderInput,
  rotate: RotateCw,
  power: Power,
  resync: RefreshCw,
  clock: Clock3,
  map: MapIcon,
  siren: Siren,
  drill: Megaphone,
  allClear: ShieldCheck,
  message: MessageSquare,
  invite: UserPlus,
  joined: UserCheck,
  role: UserCog,
  removePerson: UserMinus,
  key: KeyRound,
  signIn: LogIn,
  support: LifeBuoy,
  settings: Settings2,
  brand: Palette,
  location: Building2,
  plug: Plug,
  billing: CreditCard,
  sports: Trophy,
  menu: UtensilsCrossed,
  shield: ShieldHalf,
};

const TONE_CLASS: Record<Exclude<ActivityTone, 'brand'>, string> = {
  sky: 'bg-sky-50 text-sky-600',
  rose: 'bg-rose-50 text-rose-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  slate: 'bg-slate-100 text-slate-600',
};

const BRAND_STYLE: CSSProperties = {
  background: 'color-mix(in srgb, var(--brand-primary, #6366f1) 12%, white)',
  color: 'var(--brand-primary, #4f46e5)',
};

/** The round icon chip at the start of an activity line. */
export function ActivityIconChip({ icon, tone, size = 32 }: { icon: IconName; tone: ActivityTone; size?: number }) {
  const Icon = ICONS[icon] ?? AlertTriangle;
  const cls = tone === 'brand' ? '' : TONE_CLASS[tone];
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full flex items-center justify-center ${cls}`}
      style={{ width: size, height: size, ...(tone === 'brand' ? BRAND_STYLE : null) }}
    >
      <Icon className="w-4 h-4" aria-hidden />
    </span>
  );
}
