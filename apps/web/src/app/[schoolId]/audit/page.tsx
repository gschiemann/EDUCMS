"use client";

import { useMemo, useState } from 'react';
import { FileClock, Download, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { useAuditLog, useUsers } from '@/hooks/use-api';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';

const PAGE_SIZE = 50;

const ACTION_OPTIONS = [
  '',
  'TRIGGER_EMERGENCY',
  'CLEAR_EMERGENCY',
  'LOGIN',
  'LOGOUT',
  'CREATE_USER',
  'DELETE_USER',
  'UPDATE_ROLE',
  'UPLOAD_ASSET',
  'DELETE_ASSET',
];

export default function AuditPage() {
  return (
    <RoleGate
      allowedRoles={['admin', 'SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
      fallback={
        <div className="text-center py-24 text-sm text-slate-500">
          You don't have permission to view the audit log.
        </div>
      }
    >
      <AuditViewer />
    </RoleGate>
  );
}

function AuditViewer() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);

  const { data: users } = useUsers();
  const params = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      actorId: actorId || undefined,
      action: action || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [from, to, actorId, action, page],
  );

  const { data, isLoading, isFetching } = useAuditLog(params);
  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const downloadCsv = async () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (actorId) qs.set('actorId', actorId);
    if (action) qs.set('action', action);
    const token = useUIStore.getState().token;
    const res = await fetch(`${API_URL}/audit/export?${qs.toString()}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      alert('Export failed: ' + res.status);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const resetPage = () => setPage(0);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-100 text-indigo-700">
            <FileClock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Audit Log</h1>
            <p className="text-xs text-slate-500">Immutable activity history for this school.</p>
          </div>
        </div>
        <button
          onClick={downloadCsv}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold shadow-sm"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </header>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => { setFrom(e.target.value); resetPage(); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => { setTo(e.target.value); resetPage(); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Actor
          <select
            value={actorId}
            onChange={(e) => { setActorId(e.target.value); resetPage(); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All users</option>
            {Array.isArray(users) && users.map((u: any) => (
              <option key={u.id} value={u.id}>{u.email}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
          Action
          <select
            value={action}
            onChange={(e) => { setAction(e.target.value); resetPage(); }}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>{a || 'All actions'}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
              <tr>
                <th className="text-left px-4 py-3">Timestamp</th>
                <th className="text-left px-4 py-3">Actor</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Target</th>
                <th className="text-left px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin inline" /> Loading…
                </td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No entries match your filters.</td></tr>
              ) : (
                items.map((row: any) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-4 py-3 text-xs text-slate-600 font-mono whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-semibold text-slate-800">{row.user?.email ?? '—'}</div>
                      <div className="text-[10px] text-slate-400">{row.user?.role ?? ''}</div>
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold text-indigo-700">{row.action}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      <div>{row.targetType}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate max-w-[220px]">{row.targetId ?? ''}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[360px] truncate" title={row.details ?? ''}>
                      {row.details ?? ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-600">
          <div>
            {total === 0 ? 'No results' : `Showing ${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
            {isFetching && <span className="ml-2 text-slate-400">(refreshing…)</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-white disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-semibold">{page + 1} / {pages}</span>
            <button
              onClick={() => setPage((p) => (p + 1 < pages ? p + 1 : p))}
              disabled={page + 1 >= pages}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-white disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
