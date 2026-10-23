"use client";

import { useEffect, useRef, useState } from 'react';
import { isFromDocumentFrame } from '@/lib/board-message-source';

type DirectoryDocument = {
  format: 'arc-riot.directory';
  version: 1;
  designId: string;
  orientation: 'landscape' | 'portrait';
  dataset: { title: string; tenants: Array<{ id: string; name: string; suite: string }>; [key: string]: unknown };
  playback: Record<string, unknown>;
  theme: Record<string, unknown>;
};

function validDocument(value: unknown): value is DirectoryDocument {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Partial<DirectoryDocument>;
  return doc.format === 'arc-riot.directory' && doc.version === 1 && typeof doc.designId === 'string' &&
    (doc.orientation === 'landscape' || doc.orientation === 'portrait') &&
    !!doc.dataset && typeof doc.dataset.title === 'string' && Array.isArray(doc.dataset.tenants) &&
    doc.dataset.tenants.length <= 500 && doc.dataset.tenants.every(row => !!row && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.suite === 'string') &&
    !!doc.playback && typeof doc.playback === 'object' && !!doc.theme && typeof doc.theme === 'object';
}

/** One structured document travels through the existing saved text-override bridge. */
export function DirectoryBoardEditor({ cfg, setField }: {
  cfg: Record<string, unknown>;
  setField: (patch: Record<string, unknown>) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ cfg, setField });
  const [failed, setFailed] = useState(false);
  useEffect(() => { latest.current = { cfg, setField }; }, [cfg, setField]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setFailed(true), 8000);
    function onMessage(event: MessageEvent) {
      const child = frame.current?.contentWindow;
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (event.source === child) {
        if (message.type === 'arc-directory-editor-ready') {
          window.clearTimeout(timeout);
          child?.postMessage({ type: 'arc-directory-load', document: latest.current.cfg.directoryDocument }, '*');
          setFailed(false);
        }
        if (message.type === 'arc-directory-document' && validDocument(message.document)) {
          const doc = message.document;
          const previous = latest.current.cfg.textOverrides;
          const text = { ...(previous && typeof previous === 'object' ? previous : {}) } as Record<string, unknown>;
          delete text['directory.payload'];
          latest.current.setField({
            directoryDocument: doc,
            contentChanged: true,
            textOverrides: text,
          });
        }
      } else if (message.type === 'arc-directory-select' && isFromDocumentFrame(event)) {
        child?.postMessage({ type: 'arc-directory-select', key: message.key }, '*');
      }
    }
    window.addEventListener('message', onMessage);
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', onMessage); };
  }, []);

  useEffect(() => {
    if (validDocument(cfg.directoryDocument)) frame.current?.contentWindow?.postMessage({ type: 'arc-directory-load', document: cfg.directoryDocument }, '*');
  }, [cfg.directoryDocument]);

  return (
    <section className="space-y-2" aria-label="Directory content, design and playback">
      <p className="text-xs leading-relaxed text-slate-600">Add destinations or paste a list. Pages grow automatically. Set rotation in Playback.</p>
      <iframe
        ref={frame}
        title="Directory editor"
        src="/templates/signage/corporate/directory/_editor/EDITOR.html?embedded=1"
        sandbox="allow-scripts allow-downloads"
        className="h-[720px] w-full rounded-lg border border-slate-200 bg-white"
      />
      {failed ? <p role="alert" className="text-xs text-red-700">The directory editor could not load. Check that the Corporate directory files are installed.</p> : null}
    </section>
  );
}
