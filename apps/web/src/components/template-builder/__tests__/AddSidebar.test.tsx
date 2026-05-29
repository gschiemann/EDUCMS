/**
 * Proof that the Canva-style left "Add" rail actually inserts the right
 * widget onto the canvas — a runnable test, not a static trace.
 *
 * Operator (2026-05-28): "Use the left side toolbar where I can add in
 * actual photos, URLs, things like that." These tests click the rail's
 * tiles the way an operator would and confirm each calls the insert
 * callback with the correct widgetType, and that the media tiles route
 * through the asset picker and stamp the picked URL onto the new zone's
 * config (config.assetUrl — the key ImageWidget/VideoWidget read).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { AddSidebar } from '../AddSidebar';

// Stub asset picker — stands in for the real shared AssetLibraryModal so
// the test doesn't need the useAssets() React-Query hook. Exposes a button
// that fires onPick with a fixed URL, mimicking the operator picking/
// uploading a photo.
const PICKED_URL = 'https://cdn.example.com/photo.jpg';
function StubPicker({ kind, onPick }: { kind: 'image' | 'video'; onPick: (url: string) => void; onClose: () => void }) {
  return (
    <div role="dialog" aria-label={`stub-${kind}-picker`}>
      <button type="button" onClick={() => onPick(PICKED_URL)}>pick-asset</button>
    </div>
  );
}

function setup() {
  const onInsert = jest.fn((_: string) => 'new-zone-id');
  const onSetConfig = jest.fn();
  const utils = render(
    <AddSidebar onInsert={onInsert} onSetConfig={onSetConfig} AssetPicker={StubPicker as any} />,
  );
  return { onInsert, onSetConfig, ...utils };
}

describe('AddSidebar — the left "Add" rail inserts real widgets', () => {
  it('Add Text inserts a TEXT widget', () => {
    const { onInsert } = setup();
    fireEvent.click(screen.getByTestId('add-text'));
    expect(onInsert).toHaveBeenCalledWith('TEXT');
  });

  it('Add Webpage inserts a WEBPAGE widget', () => {
    const { onInsert } = setup();
    fireEvent.click(screen.getByTestId('add-url'));
    expect(onInsert).toHaveBeenCalledWith('WEBPAGE');
  });

  it('Add QR code inserts the TOUCH_QR tile (canonicalises to a QR variant)', () => {
    const { onInsert } = setup();
    fireEvent.click(screen.getByTestId('add-qr'));
    expect(onInsert).toHaveBeenCalledWith('TOUCH_QR');
  });

  it('Add Shape inserts a TEXT zone and stamps a solid colour block config', () => {
    const { onInsert, onSetConfig } = setup();
    fireEvent.click(screen.getByTestId('add-shape'));
    expect(onInsert).toHaveBeenCalledWith('TEXT');
    expect(onSetConfig).toHaveBeenCalledWith('new-zone-id', { content: '', bgColor: '#6366f1' });
  });

  it('Add Image opens the asset picker, then inserts IMAGE + stamps the picked URL', () => {
    const { onInsert, onSetConfig } = setup();
    // Picker is not open until the tile is clicked.
    expect(screen.queryByRole('dialog', { name: /stub-image-picker/i })).toBeNull();
    fireEvent.click(screen.getByTestId('add-image'));
    // Picker opens; no insert yet (operator hasn't chosen a photo).
    expect(screen.getByRole('dialog', { name: /stub-image-picker/i })).toBeInTheDocument();
    expect(onInsert).not.toHaveBeenCalled();
    // Operator picks/uploads a photo → insert IMAGE + set assetUrl.
    fireEvent.click(screen.getByText('pick-asset'));
    expect(onInsert).toHaveBeenCalledWith('IMAGE');
    expect(onSetConfig).toHaveBeenCalledWith('new-zone-id', { assetUrl: PICKED_URL });
    // Picker closes after pick.
    expect(screen.queryByRole('dialog', { name: /stub-image-picker/i })).toBeNull();
  });

  it('Add Video opens the asset picker, then inserts VIDEO + stamps the picked URL', () => {
    const { onInsert, onSetConfig } = setup();
    fireEvent.click(screen.getByTestId('add-video'));
    expect(screen.getByRole('dialog', { name: /stub-video-picker/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText('pick-asset'));
    expect(onInsert).toHaveBeenCalledWith('VIDEO');
    expect(onSetConfig).toHaveBeenCalledWith('new-zone-id', { assetUrl: PICKED_URL });
  });
});
