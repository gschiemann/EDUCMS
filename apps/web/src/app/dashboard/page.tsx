import React from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { EmergencyPanel } from '../../components/emergency/EmergencyPanel';
import { Activity, Server } from 'lucide-react';

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <div className="space-y-8">
        
        {/* Page Header */}
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Admin Overview</h1>
            <p className="text-slate-500 mt-1">Manage screens, assets, and emergency protocols.</p>
          </div>
        </div>

        {/* Emergency Row - Positioned prominently but safely */}
        <EmergencyPanel />

        {/* Telemetry Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard 
            title="Active Screens" 
            value="142" 
            subValue="+3 provisioned today" 
            icon={<MonitorPlay className="text-green-500" />} 
          />
          <MetricCard 
            title="Heartbeat Health" 
            value="99.8%" 
            subValue="Last sync 12s ago" 
            icon={<Activity className="text-blue-500" />} 
          />
          <MetricCard 
            title="Cache Integrity" 
            value="Verified" 
            subValue="Zero payload drifts" 
            icon={<Server className="text-indigo-500" />} 
          />
        </div>

      </div>
    </DashboardLayout>
  );
}

// Temporary icon imports for MetricCard
import { MonitorPlay } from 'lucide-react';

const MetricCard = ({ title, value, subValue, icon }: any) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
    <div className="flex justify-between items-start mb-4">
      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
        {icon}
      </div>
    </div>
    <div>
      <h3 className="text-3xl font-bold text-slate-900 dark:text-white">{value}</h3>
      <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mt-1">{title}</h4>
      <p className="text-xs text-slate-400 mt-2">{subValue}</p>
    </div>
  </div>
);
