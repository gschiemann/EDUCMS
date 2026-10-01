// Individual text editing inside the same opaque-origin iframe as the board.
// Only the builder can arm gestures; saved offsets render on signs as well.
export function initTextLayout(initialStyles: Record<string, unknown>) {
  const stage = document.querySelector<HTMLElement>(".stage");
  if (!stage) return;
  const fields = Array.from(stage.querySelectorAll<HTMLElement>("[data-field]"))
    .filter(el => !el.closest("[hidden],[data-controls]") && !el.hasAttribute("data-imgslot"));
  const keys = [...new Set(fields.map(el => el.dataset.field!))];
  const authored = new Map<HTMLElement, { value: string; priority: string; base: string }>();
  let styles: Record<string, Record<string, unknown>> = {};
  let editing = false;
  let selected: HTMLElement | null = null;
  let drag: { el: HTMLElement; id: number; x: number; y: number; startX: number; startY: number; scale: number; moved: boolean; minX: number; maxX: number; minY: number; maxY: number } | null = null;
  let suppressClick = false;
  const post = (data: object) => parent.postMessage(data, "*");
  const offset = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? Math.max(-16000, Math.min(16000, v)) : 0;
  const clamp = (v: number, min: number, max: number) => offset(Math.max(min, Math.min(Math.max(min, max), v)));
  const point = (el: HTMLElement) => ({ x: offset(styles[el.dataset.field!]?.offsetX), y: offset(styles[el.dataset.field!]?.offsetY) });
  function transform(el: HTMLElement, x: number, y: number) {
    if (!authored.has(el)) {
      const value = el.style.getPropertyValue("transform");
      const priority = el.style.getPropertyPriority("transform");
      const animation = el.style.getPropertyValue("animation");
      const animationPriority = el.style.getPropertyPriority("animation");
      el.style.setProperty("animation", "none", "important");
      const base = getComputedStyle(el).transform;
      if (animation) el.style.setProperty("animation", animation, animationPriority);
      else el.style.removeProperty("animation");
      authored.set(el, { value, priority, base: base === "none" ? "" : base });
    }
    const original = authored.get(el)!;
    if (x || y) el.style.setProperty("transform", "translate(" + x + "px," + y + "px) " + original.base, "important");
    else if (original.value) el.style.setProperty("transform", original.value, original.priority);
    else el.style.removeProperty("transform");
  }
  function apply(next: Record<string, unknown>) {
    styles = {};
    for (const [key, value] of Object.entries(next || {})) {
      if (value && typeof value === "object" && !Array.isArray(value)) styles[key] = value as Record<string, unknown>;
    }
    fields.forEach(el => {
      const p = point(el);
      if (p.x || p.y || authored.has(el)) transform(el, p.x, p.y);
    });
  }
  function select(el: HTMLElement | null) {
    selected?.removeAttribute("data-layout-selected");
    selected = el;
    selected?.setAttribute("data-layout-selected", "");
    post({ type: "educms-field-select", key: el?.dataset.field ?? null });
  }
  function target(event: Event) {
    const el = (event.target as Element | null)?.closest<HTMLElement>("[data-field]");
    return el && fields.includes(el) ? el : null;
  }
  function cancel() {
    if (drag) transform(drag.el, drag.startX, drag.startY);
    drag = null;
  }
  function announce() { post({ type: "educms-layout-ready", keys }); }
  const css = document.createElement("style");
  css.textContent = 'html[data-educms-layout-edit] .stage [data-field]{cursor:move!important;touch-action:none}html[data-educms-layout-edit] [data-layout-selected]{outline:2px solid #6366f1!important;outline-offset:3px}';
  document.head.appendChild(css);
  addEventListener("message", event => {
    if (event.source !== parent || !event.data || typeof event.data !== "object") return;
    const data = event.data;
    if (data.type === "educms-layout-request") announce();
    if (data.type === "educms-layout-mode") {
      editing = data.on === true;
      document.documentElement.toggleAttribute("data-educms-layout-edit", editing);
      if (!editing) { cancel(); selected?.removeAttribute("data-layout-selected"); selected = null; }
    }
    if (data.type === "educms-layout-select") {
      selected?.removeAttribute("data-layout-selected");
      selected = fields.find(el => el.dataset.field === data.key) || null;
      selected?.setAttribute("data-layout-selected", "");
    }
    if (data.type === "educms-overrides") apply(data.textStyles || {});
  });
  document.addEventListener("pointerdown", event => {
    if (!editing || event.button !== 0) return;
    const el = target(event);
    if (!el || (event.target as HTMLElement)?.isContentEditable) return;
    const p = point(el);
    const scale = stage.getBoundingClientRect().width / stage.offsetWidth;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const box = el.getBoundingClientRect(), canvas = stage.getBoundingClientRect();
    drag = { el, id: event.pointerId, x: event.clientX, y: event.clientY, startX: p.x, startY: p.y, scale, moved: false,
      minX: p.x + (canvas.left - box.left) / scale, maxX: p.x + (canvas.right - box.right) / scale,
      minY: p.y + (canvas.top - box.top) / scale, maxY: p.y + (canvas.bottom - box.bottom) / scale };
  }, true);
  document.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    event.preventDefault();
    // Capture only after the movement threshold so a normal click still edits.
    try { drag.el.setPointerCapture(event.pointerId); } catch { /* detached */ }
    transform(drag.el, clamp(drag.startX + dx / drag.scale, drag.minX, drag.maxX), clamp(drag.startY + dy / drag.scale, drag.minY, drag.maxY));
  }, true);
  document.addEventListener("pointerup", event => {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    if (!current.moved) return;
    suppressClick = true;
    const x = clamp(current.startX + (event.clientX - current.x) / current.scale, current.minX, current.maxX);
    const y = clamp(current.startY + (event.clientY - current.y) / current.scale, current.minY, current.maxY);
    styles[current.el.dataset.field!] = { ...styles[current.el.dataset.field!], offsetX: x, offsetY: y };
    select(current.el);
    post({ type: "educms-field-move", key: current.el.dataset.field, offsetX: x, offsetY: y });
    event.preventDefault();
    // A cancelled browser click must not swallow the operator's next click.
    setTimeout(() => { suppressClick = false; }, 0);
  }, true);
  document.addEventListener("pointercancel", cancel, true);
  document.addEventListener("click", event => {
    if (!editing) return;
    if (suppressClick) { suppressClick = false; event.preventDefault(); event.stopImmediatePropagation(); return; }
    select(target(event));
  }, true);
  document.addEventListener("keydown", event => {
    if (!editing || (event.target as HTMLElement)?.isContentEditable) return;
    if ((event.metaKey || event.ctrlKey) && /^[zy]$/i.test(event.key)) {
      event.preventDefault();
      post({ type: "educms-field-history", redo: event.shiftKey || event.key.toLowerCase() === "y" });
    } else if (event.key === "Escape") { cancel(); select(null); }
    else if (selected && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      post({ type: "educms-field-delete", key: selected.dataset.field });
    } else if (selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const p = point(selected), step = event.shiftKey ? 10 : 1;
      post({ type: "educms-field-move", key: selected.dataset.field,
        offsetX: offset(p.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0)),
        offsetY: offset(p.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0)) });
    }
  }, true);
  apply(initialStyles);
  announce();
}
