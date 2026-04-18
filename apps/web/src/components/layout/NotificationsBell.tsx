"use client";

import { Bell, Check, CheckCheck, AlertTriangle, ShieldAlert, WifiOff, Info, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/use-api';

function kindIcon(kind: string) {
  switch (kind) {
    case 'SCREEN_OFFLINE': return <WifiOff className="w-4 h-4 text-amber-500" />;
    case 'SYNC_FAILED': return <AlertTriangle className="w-4 h-4 text-amber-600" />;
    case 'EMERGENCY_TRIGGERED': return <ShieldAlert className="w-4 h-4 text-red-600" />;
    case 'INVITE_ACCEPTED': return <UserPlus className="w-4 h-4 text-emerald-600" />;
    default: return <Info className="w-4 h-4 text-slate-500" />;
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const activeTenant = useAppStore((s) => s.activeTenant);
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const ref = useRef<HTMLDivElement>(null);

  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = (n: { id: string; isRead: boolean; link?: string | null }) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.link) {
      // Scope link under the active school if it's a relative app path.
      const path = n.link.startsWith('/') && activeTenant ? `/${activeTenant}${n.link}` : n.link;
      router.push(path);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative w-9 h-9 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center text-slate-600 transition-all"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shadow">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 w-[380px] max-h-[480px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <div className="text-sm font-bold text-slate-800">Notifications</div>
            <button
              onClick={() => markAll.mutate()}
              disabled={unread === 0 || markAll.isPending}
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-slate-300 flex items-center gap-1"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-400">You're all caught up.</div>
            ) : (
              items.map((n: any) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full text-left flex gap-3 px-4 py-3 border-b border-slate-50 last:border-0 transition-colors ${
                    n.isRead ? 'bg-white hover:bg-slate-50' : 'bg-indigo-50/40 hover:bg-indigo-50'
                  }`}
                >
                  <div className="mt-0.5 shrink-0">{kindIcon(n.kind)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-xs truncate ${n.isRead ? 'font-medium text-slate-700' : 'font-bold text-slate-900'}`}>
                        {n.title}
                      </p>
                      {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0 mt-1.5" />}
                    </div>
                    {n.body && <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-slate-400 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.isRead && (
                    <span className="text-slate-300 hover:text-indigo-600 shrink-0">
                      <Check className="w-3.5 h-3.5" />
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
