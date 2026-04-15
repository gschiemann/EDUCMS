"use client";

import { Settings as SettingsIcon, Key, UserPlus, Trash2, Loader2, Shield, MonitorPlay, AlertOctagon } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { useUsers, useCreateUser, useDeleteUser, useUpdateUserRole, useTenant, useUpdateTenantPanicSettings, usePlaylists } from '@/hooks/use-api';
import { useState } from 'react';

const ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER'] as const;

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  DISTRICT_ADMIN: 'District Admin',
  SCHOOL_ADMIN: 'School Admin',
  CONTRIBUTOR: 'Contributor',
  RESTRICTED_VIEWER: 'Viewer',
};

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  DISTRICT_ADMIN: 'bg-violet-50 text-violet-700 border-violet-200',
  SCHOOL_ADMIN: 'bg-sky-50 text-sky-700 border-sky-200',
  CONTRIBUTOR: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  RESTRICTED_VIEWER: 'bg-slate-50 text-slate-600 border-slate-200',
};

export default function SettingsPage() {
  const { data: users, isLoading: usersLoading } = useUsers();
  const { data: tenant, isLoading: tenantLoading } = useTenant();
  const { data: playlists } = usePlaylists();
  
  const createUser = useCreateUser();
  const deleteUser = useDeleteUser();
  const updateRole = useUpdateUserRole();
  const updatePanicSettings = useUpdateTenantPanicSettings();
  const [showAddUser, setShowAddUser] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<string>('CONTRIBUTOR');

  const handleAddUser = async () => {
    if (!newEmail.trim() || !newPassword.trim()) return;
    await createUser.mutateAsync({ email: newEmail, password: newPassword, role: newRole });
    setNewEmail('');
    setNewPassword('');
    setShowAddUser(false);
  };

  const playerUrl = typeof window !== 'undefined' ? `${window.location.origin}/player` : 'http://localhost:3000/player';

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-800 flex items-center gap-2">
          <SettingsIcon className="w-7 h-7 text-indigo-500" />
          Settings
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage team members, roles, and system info.</p>
      </div>

      <RoleGate
        allowedRoles={['admin']}
        fallback={
          <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 text-center">
            <Key className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-sm font-bold text-slate-700">Admin Access Required</h3>
            <p className="text-xs text-slate-500 mt-2">Contact your administrator to manage settings.</p>
          </div>
        }
      >
        {/* System Info */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
            <MonitorPlay className="w-4 h-4 text-indigo-500" /> System Info
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Player URL</p>
              <code className="text-xs text-slate-700 select-all">{playerUrl}</code>
            </div>
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">API Endpoint</p>
              <code className="text-xs text-slate-700 select-all">{process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1'}</code>
            </div>
          </div>
        </div>

        {/* Panic Button Mapping */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
             <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
               <AlertOctagon className="w-4 h-4 text-red-500" /> Panic Button Integrations
             </h2>
             <p className="text-xs text-slate-500 mt-1">Bind specific CMS playlists to the mobile panic button trigger events.</p>
          </div>
          <div className="p-6">
            {tenantLoading ? (
               <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* Lockdown Mapping */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <h3 className="text-sm font-bold text-slate-800">Lockdown</h3>
                  </div>
                  <select 
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    value={tenant?.panicLockdownPlaylistId || ''}
                    onChange={(e) => updatePanicSettings.mutate({ panicLockdownPlaylistId: e.target.value || null })}
                    disabled={updatePanicSettings.isPending}
                  >
                    <option value="">No explicit playlist (Default Red Screen)</option>
                    {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                {/* Weather Mapping */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-amber-500" />
                    <h3 className="text-sm font-bold text-slate-800">Tornado / Weather</h3>
                  </div>
                  <select 
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    value={tenant?.panicWeatherPlaylistId || ''}
                    onChange={(e) => updatePanicSettings.mutate({ panicWeatherPlaylistId: e.target.value || null })}
                    disabled={updatePanicSettings.isPending}
                  >
                    <option value="">No explicit playlist (Default Red Screen)</option>
                    {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

                {/* Evacuate Mapping */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-orange-500" />
                    <h3 className="text-sm font-bold text-slate-800">Evacuate</h3>
                  </div>
                  <select 
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    value={tenant?.panicEvacuatePlaylistId || ''}
                    onChange={(e) => updatePanicSettings.mutate({ panicEvacuatePlaylistId: e.target.value || null })}
                    disabled={updatePanicSettings.isPending}
                  >
                    <option value="">No explicit playlist (Default Red Screen)</option>
                    {playlists?.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* Team Members */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-500" /> Team Members
            </h2>
            <button
              onClick={() => setShowAddUser(true)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add User
            </button>
          </div>

          {showAddUser && (
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-100">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Email address" type="email"
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" autoFocus />
                <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Password" type="password"
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500" />
                <select value={newRole} onChange={(e) => setNewRole(e.target.value)}
                  className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-indigo-500">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={handleAddUser} disabled={createUser.isPending}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg">
                  {createUser.isPending ? 'Adding...' : 'Add User'}
                </button>
                <button onClick={() => setShowAddUser(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700 text-xs font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {usersLoading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
            </div>
          )}

          {users && (
            <div className="divide-y divide-slate-50">
              {users.map((user: any) => (
                <div key={user.id} className="flex items-center justify-between px-6 py-3 hover:bg-slate-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold">
                      {user.email?.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-slate-800">{user.email}</p>
                      <p className="text-[10px] text-slate-400">{user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'Member'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <select
                      value={user.role}
                      onChange={(e) => updateRole.mutate({ id: user.id, role: e.target.value })}
                      className={`px-2.5 py-1 text-[10px] font-bold border rounded-lg cursor-pointer ${ROLE_COLORS[user.role] || 'bg-slate-50 text-slate-600'}`}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                    </select>
                    <button
                      onClick={() => { if (confirm(`Remove ${user.email}?`)) deleteUser.mutate(user.id); }}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </RoleGate>
    </div>
  );
}
