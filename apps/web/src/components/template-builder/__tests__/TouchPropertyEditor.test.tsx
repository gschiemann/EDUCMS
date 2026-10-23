import { render, screen, fireEvent, act } from '@testing-library/react';
import { TouchPropertyEditor } from '../TouchPropertyEditor';

let mockStatus = 'PUBLISHED';
jest.mock('@/components/ai/AiImageGenerateButton', () => ({
  AiImageGenerateButton: ({ onGenerated }: { onGenerated: (asset: Record<string, string>) => void }) => (
    <button onClick={() => onGenerated({ id: 'new-image', fileUrl: 'https://example.test/generated.png', name: 'Prospect workplace concept', status: mockStatus })}>Generate test concept</button>
  ),
}));

const document = {
  format: 'arc-riot.touch-property', version: 1,
  property: { name: 'Northstar' }, settings: { idleSeconds: 180 },
  assets: { reference: { src: 'https://example.test/original.png', kind: 'actual-photo', original: true }, orbit: { src: 'https://example.test/old.png', kind: 'ai-concept' } },
  spaces: [], amenities: [], places: [],
};

afterEach(() => { mockStatus = 'PUBLISHED'; });

it('places a generated concept in the chosen slot and preserves the original reference', () => {
  const setField = jest.fn();
  render(<TouchPropertyEditor cfg={{ touchDocument: document }} setField={setField} />);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fieldwork' } });
  fireEvent.click(screen.getByText('Generate test concept'));
  const patch = setField.mock.calls[0][0];
  expect(patch.touchDocument.assets.reference).toEqual(document.assets.reference);
  expect(patch.touchDocument.assets.orbit).toEqual(document.assets.orbit);
  expect(patch.touchDocument.assets.fieldwork).toMatchObject({ src: 'https://example.test/generated.png', kind: 'ai-concept', original: false });
  expect(patch.contentChanged).toBe(true);
});

it('keeps an image awaiting approval out of the template', () => {
  mockStatus = 'PENDING_APPROVAL';
  const setField = jest.fn();
  render(<TouchPropertyEditor cfg={{ touchDocument: document }} setField={setField} />);
  fireEvent.click(screen.getByText('Generate test concept'));
  expect(setField).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('needs approval');
});

it('accepts document updates from its embedded editor and refuses another window', () => {
  const setField = jest.fn();
  const { container } = render(<TouchPropertyEditor cfg={{ touchDocument: document }} setField={setField} />);
  const data = { type: 'arc-touch-document', document: { ...document, property: { name: 'Changed property' } } };
  act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data })));
  expect(setField).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new MessageEvent('message', { source: container.querySelector('iframe')!.contentWindow, data })));
  expect(setField).toHaveBeenCalledWith(expect.objectContaining({ touchDocument: data.document, contentChanged: true }));
});
