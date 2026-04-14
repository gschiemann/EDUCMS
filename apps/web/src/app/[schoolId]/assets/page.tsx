import React from 'react';
import { MediaAsset } from '@cms/api-types';

export default async function AssetsPage({ params }: { params: { schoolId: string } }) {
  // Stubbing fetch from backend
  const assets: MediaAsset[] = [
    { id: "asset_1a", status: "APPROVED", remoteUrl: "https://cdn.educms.link/h1.mp4", hash: "a1b2c", size: 5000000 },
    { id: "asset_2b", status: "PENDING_REVIEW", remoteUrl: "https://cdn.educms.link/h2.mp4", hash: "d3e4f", size: 8500000 },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6 text-slate-800">Media Assets</h1>
      
      <div className="bg-white rounded-lg shadow border border-slate-200">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-sm font-semibold text-slate-600">ID</th>
              <th className="px-6 py-4 text-sm font-semibold text-slate-600">URL</th>
              <th className="px-6 py-4 text-sm font-semibold text-slate-600">Status</th>
              <th className="px-6 py-4 text-sm font-semibold text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {assets.map((asset) => (
              <tr key={asset.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 text-sm font-mono text-slate-500">{asset.id}</td>
                <td className="px-6 py-4 text-sm text-blue-600 underline cursor-pointer">{asset.remoteUrl.split('/').pop()}</td>
                <td className="px-6 py-4">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    asset.status === 'APPROVED' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800 animate-pulse'
                  }`}>
                    {asset.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm">
                  {asset.status === 'PENDING_REVIEW' && (
                    <button className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-md shadow-sm transition-transform active:scale-95">
                      Review & Approve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
