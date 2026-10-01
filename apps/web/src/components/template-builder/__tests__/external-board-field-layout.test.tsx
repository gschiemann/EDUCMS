import { act, render } from "@testing-library/react";
import { ExternalBoardFieldBridge, patchBoardField, deleteSelectedBoardField } from "../ExternalBoardFieldBridge";
import { useBuilderStore } from "../useBuilderStore";
import { toCssTextStyleMap } from "../../widgets/text-style-contract";
import type { Zone } from "../types";

function seed(locked = false) {
  useBuilderStore.getState().init({ id: "board", isSystem: false, scenes: [],
    meta: { name: "Board", description: "", screenWidth: 3840, screenHeight: 2160, bgColor: "", bgGradient: "", bgImage: "" },
    zones: [{ id: "scene", name: "Board", widgetType: "EXTERNAL_HTML", x: 0, y: 0, width: 100, height: 100,
      zIndex: 1, sortOrder: 0, locked, defaultConfig: { url: "/templates/custom/brookfield/07-tour-takeaway.html",
        textOverrides: { caption: "My caption" }, _styles: { caption: { color: "red" }, title: { bold: true } } } } as Zone] });
}
function cfg() { return useBuilderStore.getState().zones[0].defaultConfig as { textOverrides: Record<string, string>; _styles: Record<string, { color?: string; offsetX?: number; offsetY?: number; hidden?: boolean; bold?: boolean }> }; }
function message(frame: HTMLIFrameElement, data: object) {
  act(() => window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, data })));
}

it("preserves copy, other styles and the scene; each completed move/delete has its own Undo and Redo", () => {
  seed();
  patchBoardField("scene", "caption", { offsetX: 210, offsetY: -45 });
  useBuilderStore.getState().select("scene");
  useBuilderStore.getState().setActiveFieldName("caption");
  expect(deleteSelectedBoardField()).toBe(true);
  expect(useBuilderStore.getState().zones).toHaveLength(1);
  expect(cfg()._styles.caption).toEqual({ color: "red", offsetX: 210, offsetY: -45, hidden: true });
  expect(cfg().textOverrides.caption).toBe("My caption");
  expect(cfg()._styles.title.bold).toBe(true);
  useBuilderStore.getState().undo();
  expect(cfg()._styles.caption.hidden).toBeUndefined();
  useBuilderStore.getState().undo();
  expect(cfg()._styles.caption).toEqual({ color: "red" });
  useBuilderStore.getState().redo();
  expect(cfg()._styles.caption.offsetX).toBe(210);
});

it("accepts only advertised fields from the actual canvas board window, and rejects malformed offsets", () => {
  seed();
  const { container } = render(<div data-template-canvas><div data-zone-id="scene"><iframe title="Board" /></div><ExternalBoardFieldBridge /></div>);
  const frame = container.querySelector("iframe")!;
  message(frame, { type: "educms-layout-ready", keys: ["caption"] });
  act(() => window.dispatchEvent(new MessageEvent("message", { source: window, data: { type: "educms-field-move", key: "caption", offsetX: 4, offsetY: 5 } })));
  message(frame, { type: "educms-field-move", key: "title", offsetX: 4, offsetY: 5 });
  message(frame, { type: "educms-field-move", key: "caption", offsetX: "4", offsetY: 5 });
  message(frame, { type: "educms-field-move", key: "caption", offsetX: Infinity, offsetY: 5 });
  message(frame, { type: "educms-field-move", key: "caption", offsetX: 16001, offsetY: 5 });
  expect(cfg()._styles.caption).toEqual({ color: "red" });
  // Selection and completion are separate messages from the same gesture.
  message(frame, { type: "educms-field-select", key: "caption" });
  message(frame, { type: "educms-field-move", key: "caption", offsetX: 4, offsetY: 5 });
  expect(cfg()._styles.caption).toEqual({ color: "red", offsetX: 4, offsetY: 5 });
  expect(useBuilderStore.getState().activeFieldName).toBe("caption");
});

it("does not edit locked boards or a preview", () => {
  seed(true);
  patchBoardField("scene", "caption", { hidden: true });
  expect(cfg()._styles.caption.hidden).toBeUndefined();
  seed();
  useBuilderStore.setState({ previewMode: true });
  patchBoardField("scene", "caption", { hidden: true });
  expect(cfg()._styles.caption.hidden).toBeUndefined();
  useBuilderStore.setState({ previewMode: false });
});

it("sends saved finite offsets and hidden state over the existing renderer style transport", () => {
  expect(toCssTextStyleMap({ caption: { offsetX: 210, offsetY: -45, hidden: true, color: "red" } })).toEqual({ caption: { color: "red", offsetX: 210, offsetY: -45, hidden: true } });
  expect(toCssTextStyleMap({ caption: { offsetX: NaN, offsetY: Infinity } })).toEqual({});
});
