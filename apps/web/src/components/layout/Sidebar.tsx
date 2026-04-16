import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ShieldAlert, LayoutDashboard, MonitorPlay, Folders, Settings, Upload, LayoutTemplate, LogOut } from 'lucide-react';
import { RoleGate } from '../RoleGate';

export function Sidebar() {
  const pathname = usePathname() || '';
  const activeTenant = useAppStore((state) => state.activeTenant);
  const user = useAppStore((state) => state.user);
  const logout = useAppStore((state) => state.logout);
  const router = useRouter();

  const navItems = [
    { name: 'Dashboard', href: `/${activeTenant}/dashboard`, icon: LayoutDashboard },
    { name: 'Screens', href: `/${activeTenant}/screens`, icon: MonitorPlay },
    { name: 'Templates', href: `/${activeTenant}/templates`, icon: LayoutTemplate },
    { name: 'Assets', href: `/${activeTenant}/assets`, icon: Upload },
    { name: 'Playlists', href: `/${activeTenant}/playlists`, icon: Folders },
    { name: 'Settings', href: `/${activeTenant}/settings`, icon: Settings },
  ];

  return (
    <aside className="w-72 flex flex-col bg-white border-r border-slate-100/50 h-full shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20">
      <div className="h-[73px] flex items-center px-6">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-800 flex items-center gap-2.5">
          <div className="bg-gradient-to-br from-indigo-500 to-violet-500 p-2 rounded-2xl text-white shadow-md shadow-indigo-500/20">
            <MonitorPlay className="w-5 h-5" />
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700">EduSignage</span>
        </h1>
      </div>

      <nav className="flex-1 py-6 px-4 space-y-1 overflow-y-auto">
        <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-4 px-4">
          Main Menu
        </div>
        {navItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3.5 px-4 py-3.5 rounded-2xl text-[14px] font-bold transition-all duration-300 group relative overflow-hidden",
                isActive 
                  ? "text-indigo-700 bg-indigo-50/80 shadow-[0_2px_10px_rgba(99,102,241,0.05)]" 
                  : "text-slate-500 hover:text-indigo-600 hover:bg-slate-50"
              )}
            >
              {/* Active Indicator Bar */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-indigo-500 rounded-r-full shadow-[0_0_8px_rgba(99,102,241,0.5)]" />
              )}
              <item.icon className={cn(
                "w-[22px] h-[22px] transition-transform duration-300", 
                isActive ? "scale-110 drop-shadow-sm" : "group-hover:scale-110"
              )} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 pb-5 space-y-2">
        <RoleGate allowedRoles={['admin']}>
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Admin</span>
          </div>
        </RoleGate>

        {/* User info + Logout */}
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0 shadow-sm">
            {user?.email?.substring(0, 2).toUpperCase() || '??'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-slate-700 truncate">{user?.email || 'User'}</p>
            <p className="text-[9px] text-slate-400">{user?.role?.replace(/_/g, ' ') || 'Role'}</p>
          </div>
          <button
            onClick={() => { logout(); router.push('/login'); }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
