import React from 'react';
import { LayoutDashboard, Users, Image as ImageIcon, ListVideo, MonitorPlay, ShieldAlert } from 'lucide-react';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between">
        <div>
          <div className="h-16 flex items-center px-6 border-b border-slate-200 dark:border-slate-800">
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
              SchoolCMS
            </h1>
          </div>
          <nav className="p-4 space-y-1">
            <NavItem icon={<LayoutDashboard size={20} />} label="Overview" active />
            <NavItem icon={<MonitorPlay size={20} />} label="Screens Fleet" />
            <NavItem icon={<ImageIcon size={20} />} label="Asset Library" />
            <NavItem icon={<ListVideo size={20} />} label="Playlists" />
            <NavItem icon={<Users size={20} />} label="Staff Directory" />
          </nav>
        </div>
        <div className="p-4 border-t border-slate-200 dark:border-slate-800">
          <NavItem icon={<ShieldAlert size={20} />} label="System Audit" />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 shadow-sm">
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium text-slate-500">Active Scope:</span>
            <span className="text-sm font-bold px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-800 dark:text-slate-200">
              Lincoln High School
            </span>
          </div>
          <div className="flex items-center space-x-4">
            <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold shadow-md">
              A
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-6xl mx-auto">
             {children}
          </div>
        </div>
      </main>
    </div>
  );
};

const NavItem = ({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) => {
  return (
    <div className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer ${active ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 font-semibold' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
};
