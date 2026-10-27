/** Shared canvas typing behavior for native widgets and sandboxed directory fields. */
export function beginInlineTextEdit(target: HTMLElement, onCommit: (value: string) => void, maxLength = Infinity) {
  if (target.isContentEditable) return;
  const doc = target.ownerDocument;
  const original = target.innerText ?? target.textContent ?? '';
  const properties = ['outline', 'outline-offset', 'background', 'border-radius', 'cursor', 'user-select', '-webkit-user-select', 'caret-color'];
  const before = properties.map(key => [key, target.style.getPropertyValue(key), target.style.getPropertyPriority(key)]);
  const pause = target.closest<HTMLElement>('[data-inline-edit-pause]');
  const paused = pause?.style.animationPlayState ?? '';
  let finished = false;
  target.setAttribute('contenteditable', 'true');
  target.style.outline = '2px solid #6366f1';
  target.style.outlineOffset = '2px';
  target.style.background = 'rgba(99,102,241,0.08)';
  target.style.borderRadius = '3px';
  target.style.cursor = 'text';
  target.style.userSelect = 'text';
  target.style.setProperty('-webkit-user-select', 'text');
  target.style.caretColor = 'auto';
  if (pause) pause.style.animationPlayState = 'paused';
  function finish(commit: boolean) {
    if (finished) return;
    finished = true;
    target.removeEventListener('blur', blur);
    target.removeEventListener('keydown', key);
    target.removeEventListener('paste', paste);
    target.removeEventListener('drop', drop);
    const value = (target.innerText ?? target.textContent ?? '').replace(/\u00a0/g, ' ').slice(0, maxLength);
    target.removeAttribute('contenteditable');
    before.forEach(([name, value, priority]) => value ? target.style.setProperty(name, value, priority) : target.style.removeProperty(name));
    if (pause) pause.style.animationPlayState = paused;
    // Flatten pasted content into text nodes; never carry markup into saved content.
    target.textContent = commit ? value : original;
    if (commit && value !== original) onCommit(value);
  }
  function blur() { finish(true); }
  function key(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finish(true); }
    else if (event.key === 'Escape') { event.preventDefault(); finish(false); }
  }
  function insert(text: string) {
    const selection = doc.defaultView?.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!target.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = doc.createTextNode(text.slice(0, maxLength));
    range.insertNode(node); range.setStartAfter(node); range.collapse(true);
    selection.removeAllRanges(); selection.addRange(range);
  }
  function paste(event: ClipboardEvent) { event.preventDefault(); insert(event.clipboardData?.getData('text/plain') || ''); }
  function drop(event: DragEvent) { event.preventDefault(); }
  target.addEventListener('blur', blur);
  target.addEventListener('keydown', key);
  target.addEventListener('paste', paste);
  target.addEventListener('drop', drop);
  target.focus();
  const range = doc.createRange(); range.selectNodeContents(target);
  const selection = doc.defaultView?.getSelection();
  selection?.removeAllRanges(); selection?.addRange(range);
  return () => finish(false);
}
