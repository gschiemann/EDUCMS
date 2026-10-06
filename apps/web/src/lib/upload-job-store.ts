'use client';

import { create } from 'zustand';
import { useUIStore } from '@/store/ui-store';
import { createUploadQueue } from '@/lib/upload-queue';
import type { CompletedAsset } from '@/lib/direct-upload';
import type { VideoEncodeState } from '@/lib/video-encode-copy';

export type UploadPhase = 'idle' | 'uploading' | 'processing' | 'success' | 'pending-review' | 'error';
export interface UploadItem {
  id: string; file: File; progress: number; phase: UploadPhase;
  ownerUserId: string; ownerTenantId: string; folderId: string | null;
  error?: string; canRetry?: boolean; encode?: VideoEncodeState;
  sent?: number; note?: string; asset?: CompletedAsset; paused?: boolean;
}

/** Files stay in this tab's memory, outside page lifecycles. No credentials
 * or file data are written to localStorage. A full browser close still ends
 * client transfers; ordinary application navigation does not. */
export const useUploadJobStore = create<{ items: UploadItem[] }>(() => ({ items: [] }));
type Runner = (signal: AbortSignal) => Promise<void>;
const runners = new Map<string, Runner>();
const controllers = new Map<string, AbortController>();
const scheduled = new Set<string>();
// Signed uploads stream bounded chunks; videos and images share the same
// three slots, across pages and batches, rather than serialising phones.
const queue = createUploadQueue(() => 3);
const owns = (item: UploadItem) => {
  const user = useUIStore.getState().user;
  return user?.id === item.ownerUserId && user?.tenantId === item.ownerTenantId;
};
const patch = (id: string, value: Partial<UploadItem>) => useUploadJobStore.setState(state => ({ items: state.items.map(item => item.id === id ? { ...item, ...value } : item) }));

function schedule(id: string) {
  if (scheduled.has(id)) return;
  scheduled.add(id);
  queue.add([async () => {
    const item = useUploadJobStore.getState().items.find(item => item.id === id);
    try {
      if (!item || !runners.has(id)) return;
      if (!owns(item)) { patch(id, { phase: 'idle', paused: true }); return; }
      const controller = new AbortController();
      controllers.set(id, controller);
      patch(id, { paused: false });
      await runners.get(id)!(controller.signal);
    } finally {
      scheduled.delete(id); controllers.delete(id);
      const current = useUploadJobStore.getState().items.find(item => item.id === id);
      if (current?.paused && owns(current)) schedule(id);
    }
  }]);
}

export function updateUploadItems(update: (items: UploadItem[]) => UploadItem[]) {
  useUploadJobStore.setState(state => {
    const items = update(state.items);
    const retained = new Set(items.map(item => item.id));
    for (const item of state.items) if (!retained.has(item.id)) {
      controllers.get(item.id)?.abort();
      runners.delete(item.id);
    }
    return { items };
  });
}

export function clearUploadJobs(ids: string[]) {
  const removing = new Set(ids);
  updateUploadItems(items => items.filter(item => !removing.has(item.id)));
}

let watching = false;
function watchIdentity() {
  if (watching) return;
  watching = true;
  useUIStore.subscribe((state, previous) => {
    if (state.user?.id === previous.user?.id && state.user?.tenantId === previous.user?.tenantId) return;
    const items = useUploadJobStore.getState().items;
    if (!state.user || state.user.id !== previous.user?.id) {
      clearUploadJobs(items.map(item => item.id));
      return;
    }
    // Switching workspaces must never register a file under the new JWT.
    // Pause the old location's jobs; returning there resumes them safely.
    for (const item of items) {
      if (!owns(item) && ['idle', 'uploading', 'processing'].includes(item.phase)) {
        patch(item.id, { phase: 'idle', paused: true });
        controllers.get(item.id)?.abort();
      } else if (owns(item) && item.paused) schedule(item.id);
    }
  });
}

export function enqueueUploadJob(id: string, run: Runner) {
  watchIdentity(); runners.set(id, run); schedule(id);
}
