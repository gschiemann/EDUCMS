import { beginInlineTextEdit } from '../inline-text-edit';

function field(text = 'Original wording') {
  const node = document.createElement('span'); node.textContent = text;
  node.style.outline = '1px solid red'; document.body.append(node); return node;
}
afterEach(() => { document.body.replaceChildren(); });
it('shares native Enter/blur commit behavior without changing the authored styling', () => {
  const node = field(); const commit = jest.fn(); const outline = node.style.outline;
  beginInlineTextEdit(node, commit); node.textContent = 'New wording';
  node.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));
  node.dispatchEvent(new Event('blur'));
  expect(commit).toHaveBeenCalledTimes(1); expect(commit).toHaveBeenCalledWith('New wording');
  expect(node.hasAttribute('contenteditable')).toBe(false); expect(node.style.outline).toBe(outline);
});
it('cancels with Escape and does not commit while an IME composition is active', () => {
  const node = field(); const commit = jest.fn(); beginInlineTextEdit(node, commit);
  node.textContent = 'Draft'; node.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',isComposing:true}));
  expect(commit).not.toHaveBeenCalled(); node.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}));
  expect(node.textContent).toBe('Original wording'); expect(commit).not.toHaveBeenCalled();
});
it('pastes plain text without creating HTML elements and bounds directory field length', () => {
  const node = field(); const commit = jest.fn(); beginInlineTextEdit(node, commit, 40);
  const paste = new Event('paste', {bubbles:true,cancelable:true});
  Object.defineProperty(paste,'clipboardData',{value:{getData:(type:string)=>type==='text/plain'?'<img src=x onerror=alert(1)>':'<b>HTML</b>'}});
  node.dispatchEvent(paste); expect(node.querySelector('img,b')).toBeNull();
  node.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter'}));
  expect(commit).toHaveBeenCalledWith('<img src=x onerror=alert(1)>');
});
