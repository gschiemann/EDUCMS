"use client";

import { useEffect } from "react";
import { useBuilderStore } from "./useBuilderStore";

/** Change one field, preserving the rest of the board and one Undo step. */
export function patchBoardField(zoneId: string, key: string, patch: Record<string, number | boolean>) {
  const store = useBuilderStore.getState();
  const zone = store.zones.find(z => z.id === zoneId);
  if (!zone || zone.locked || zone.widgetType !== "EXTERNAL_HTML" || store.previewMode) return;
  const cfg = zone.defaultConfig || {};
  const styles: Record<string, Record<string, unknown>> = {
    ...((cfg.textStyles as Record<string, Record<string, unknown>>) || {}),
    ...((cfg._styles as Record<string, Record<string, unknown>>) || {}),
  };
  store.updateZone(zone.id, { defaultConfig: { ...cfg, textStyles: undefined,
    _styles: { ...styles, [key]: { ...styles[key], ...patch } } } }, true);
}

/** Keyboard Delete targets the selected text, never its full-board scene. */
export function deleteSelectedBoardField(): boolean {
  const store = useBuilderStore.getState();
  if (!store.activeFieldName || store.selectedIds.length !== 1) return false;
  const zone = store.zones.find(z => z.id === store.selectedIds[0]);
  if (zone?.widgetType !== "EXTERNAL_HTML") return false;
  patchBoardField(zone.id, store.activeFieldName, { hidden: true });
  return true;
}

/** Nudge advertised native text instead of moving the complete scene. */
export function nudgeSelectedBoardField(dx: number, dy: number): boolean {
  const store = useBuilderStore.getState();
  const key = store.activeFieldName;
  const zoneId = store.selectedIds.length === 1 ? store.selectedIds[0] : null;
  if (!key || !zoneId) return false;
  const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('[data-canvas-text-keys]'))
    .find(f => f.closest<HTMLElement>('[data-zone-id]')?.dataset.zoneId === zoneId);
  if (!frame || !(JSON.parse(frame.dataset.canvasTextKeys || '[]') as string[]).includes(key)) return false;
  const cfg = store.zones.find(z => z.id === zoneId)?.defaultConfig || {};
  const style = ((cfg._styles || {}) as Record<string, Record<string, unknown>>)[key] || {};
  patchBoardField(zoneId, key, { offsetX: Math.max(-16000, Math.min(16000, (Number(style.offsetX) || 0) + dx)),
    offsetY: Math.max(-16000, Math.min(16000, (Number(style.offsetY) || 0) + dy)) });
  return true;
}

/**
 * Only actual board windows inside this builder's canvas can write layout.
 * Capability keys come from that board, and each completed gesture is saved
 * through the existing zone/history store, autosave and template API.
 */
export function ExternalBoardFieldBridge() {
  const zones = useBuilderStore(s => s.zones);
  const previewMode = useBuilderStore(s => s.previewMode);
  const activeField = useBuilderStore(s => s.activeFieldName);
  useEffect(() => {
    const capabilities = new Map<Window, Set<string>>();
    function frames() {
      return Array.from(document.querySelectorAll<HTMLIFrameElement>("[data-template-canvas] [data-zone-id] iframe"));
    }
    function owner(source: MessageEventSource | null) {
      const frame = frames().find(f => f.contentWindow === source);
      const id = frame?.closest<HTMLElement>("[data-zone-id]")?.dataset.zoneId;
      const zone = useBuilderStore.getState().zones.find(z => z.id === id);
      return frame && zone?.widgetType === "EXTERNAL_HTML" ? { frame, zone } : null;
    }
    function arm(frame: HTMLIFrameElement, locked: boolean) {
      frame.contentWindow?.postMessage({ type: "educms-layout-mode", on: !locked && !useBuilderStore.getState().previewMode }, "*");
      frame.contentWindow?.postMessage({ type: "educms-layout-select", key: useBuilderStore.getState().activeFieldName }, "*");
    }
    function request() {
      frames().forEach(frame => frame.contentWindow?.postMessage({ type: "educms-layout-request" }, "*"));
    }
    const onMessage = (event: MessageEvent) => {
      const source = owner(event.source);
      const data = event.data;
      if (!source || !data || typeof data !== "object") return;
      const window = source.frame.contentWindow!;
      if (data.type === "educms-ready") {
        window.postMessage({ type: "educms-layout-request" }, "*");
        return;
      }
      if (data.type === "educms-layout-ready" && Array.isArray(data.keys)) {
        const keys = data.keys.filter((k: unknown): k is string => typeof k === "string" && k.length <= 160);
        capabilities.set(window, new Set(keys));
        source.frame.dataset.canvasTextKeys = JSON.stringify(keys);
        arm(source.frame, !!source.zone.locked);
        return;
      }
      if (!capabilities.has(window) || source.zone.locked || useBuilderStore.getState().previewMode) return;
      const store = useBuilderStore.getState();
      if (data.type === "educms-field-history") {
        if (data.redo === true) store.redo(); else store.undo();
        return;
      }
      if (data.type === "educms-field-select" && data.key === null) {
        if (store.selectedIds.includes(source.zone.id)) store.setActiveFieldName(null);
        return;
      }
      if (typeof data.key !== "string" || !capabilities.get(window)!.has(data.key)) return;
      if (!["educms-field-select", "educms-field-move", "educms-field-delete"].includes(data.type)) return;
      if (data.type === "educms-field-move" && ![data.offsetX, data.offsetY].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 16000)) return;
      store.select(source.zone.id);
      store.setActiveFieldName(data.key);
      if (data.type === "educms-field-move") patchBoardField(source.zone.id, data.key, { offsetX: data.offsetX, offsetY: data.offsetY });
      if (data.type === "educms-field-delete") patchBoardField(source.zone.id, data.key, { hidden: true });
    };
    addEventListener("message", onMessage);
    request();
    const retry = setTimeout(request, 500);
    return () => { removeEventListener("message", onMessage); clearTimeout(retry); frames().forEach(f => { delete f.dataset.canvasTextKeys; f.contentWindow?.postMessage({ type: "educms-layout-mode", on: false }, "*"); }); };
  }, []);
  // Changing a selection must not replace the message listener between a
  // field-select message and the following completed drag message.
  useEffect(() => {
    document.querySelectorAll<HTMLIFrameElement>("[data-template-canvas] [data-zone-id] iframe").forEach(frame => {
      const id = frame.closest<HTMLElement>("[data-zone-id]")?.dataset.zoneId;
      const zone = zones.find(z => z.id === id);
      if (zone?.widgetType !== "EXTERNAL_HTML") return;
      frame.contentWindow?.postMessage({ type: "educms-layout-request" }, "*");
      frame.contentWindow?.postMessage({ type: "educms-layout-mode", on: !zone.locked && !previewMode }, "*");
      frame.contentWindow?.postMessage({ type: "educms-layout-select", key: useBuilderStore.getState().selectedIds.includes(zone.id) ? activeField : null }, "*");
    });
  }, [zones, previewMode, activeField]);
  return null;
}
