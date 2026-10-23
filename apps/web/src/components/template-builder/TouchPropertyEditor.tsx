"use client";

import { useEffect, useRef, useState } from 'react';
import { isFromDocumentFrame } from '@/lib/board-message-source';
import { AiImageGenerateButton } from '@/components/ai/AiImageGenerateButton';

function isTouchDocument(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const doc = value as Record<string, unknown>;
  const property = doc.property as Record<string, unknown> | undefined;
  return doc.format === 'arc-riot.touch-property' && doc.version === 1 &&
    !!property && typeof property.name === 'string' && !!doc.settings && typeof doc.settings === 'object' &&
    ['spaces', 'amenities', 'places'].every(key => Array.isArray(doc[key]) && (doc[key] as unknown[]).length <= 500);
}

export function TouchPropertyEditor({ cfg, setField }: {
  cfg: Record<string, unknown>;
  setField: (patch: Record<string, unknown>) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [conceptSlot, setConceptSlot] = useState('orbit');
  const [imageError, setImageError] = useState('');
  const latest = useRef({ cfg, setField });
  useEffect(() => { latest.current = { cfg, setField }; }, [cfg, setField]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data;
      if (event.source !== frame.current?.contentWindow) {
        if (message.type === 'arc-touch-select' && typeof message.key === 'string' && isFromDocumentFrame(event)) {
          frame.current?.contentWindow?.postMessage({ type: 'arc-touch-select', key: message.key }, '*');
        }
        return;
      }
      if (message.type === 'arc-touch-editor-ready') {
        frame.current?.contentWindow?.postMessage({ type: 'arc-touch-load', document: latest.current.cfg.touchDocument }, '*');
      }
      if (message.type === 'arc-touch-document' && isTouchDocument(message.document)) {
        const previous = latest.current.cfg.textOverrides;
        const text = { ...(previous && typeof previous === 'object' ? previous : {}) } as Record<string, unknown>;
        delete text['cre.payload'];
        latest.current.setField({ touchDocument: message.document, contentChanged: true, textOverrides: text });
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (isTouchDocument(cfg.touchDocument)) frame.current?.contentWindow?.postMessage({ type: 'arc-touch-load', document: cfg.touchDocument }, '*');
  }, [cfg.touchDocument]);

  return (
    <section className="space-y-2" aria-label="Commercial property content editor">
      <p className="text-xs leading-relaxed text-slate-600">Update spaces, amenities, neighbourhood details and branded concepts. Save the template to keep your changes.</p>
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <label className="block text-xs font-medium">Concept preview to replace
          <select className="mt-1 w-full rounded border border-slate-300 p-2" value={conceptSlot} onChange={event => setConceptSlot(event.target.value)}>
            <option value="orbit">Concept one</option><option value="fieldwork">Concept two</option>
          </select>
        </label>
        <p className="text-xs leading-relaxed text-slate-600">Describe the prospect’s brand and workplace to create concept artwork through your CMS AI service. Your reference image stays in its own slot.</p>
        <AiImageGenerateButton onGenerated={asset => {
          if (asset.status !== 'PUBLISHED') {
            setImageError('This image needs approval in the media library before it can be used.');
            return;
          }
          setImageError('');
          const document = latest.current.cfg.touchDocument as Record<string, unknown>;
          const assets = document.assets as Record<string, unknown>;
          latest.current.setField({ touchDocument: { ...document, assets: { ...assets, [conceptSlot]: { src: asset.fileUrl, kind: 'ai-concept', label: asset.name, original: false } } }, contentChanged: true });
        }} />
        {imageError ? <p role="alert" className="text-xs text-red-700">{imageError}</p> : null}
      </div>
      <iframe ref={frame} title="Commercial property editor" src="/templates/signage/corporate/commercial-touch/_editor/index.html?embedded=1" sandbox="allow-scripts allow-downloads" className="h-[720px] w-full rounded-lg border border-slate-200 bg-white" />
    </section>
  );
}
