/**
 * Proof that the Canva-style bottom floating toolbar actually drives the
 * selected zone's config — a runnable test, not a static trace.
 *
 * Operator (2026-05-28): "Use that bottom floating toolbar to make ours
 * even better." These tests fire the highest-frequency quick actions the
 * way an operator would (click +, click −, type a size, pick a colour,
 * toggle bold, cycle alignment, reorder layers, duplicate, delete) and
 * confirm each flows back through the zone-update / action callbacks with
 * the right value. If any control stops being wired, this test fails.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomToolbar, type SelectedZoneLike } from '../BottomToolbar';

function setup(overrides?: Partial<SelectedZoneLike>, props?: { measuredFontSize?: number | null }) {
  const onConfigChange = jest.fn();
  const onBringForward = jest.fn();
  const onSendBack = jest.fn();
  const onDuplicate = jest.fn();
  const onDelete = jest.fn();
  const zone: SelectedZoneLike = {
    id: 'zone-1',
    widgetType: 'TEXT',
    defaultConfig: { content: 'Hello', fontSize: 24, color: '#1e293b' },
    ...overrides,
  };
  const utils = render(
    <BottomToolbar
      zone={zone}
      onConfigChange={onConfigChange}
      onBringForward={onBringForward}
      onSendBack={onSendBack}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      measuredFontSize={props?.measuredFontSize ?? null}
    />,
  );
  return { onConfigChange, onBringForward, onSendBack, onDuplicate, onDelete, ...utils };
}

describe('BottomToolbar — on-selection quick actions drive zone config', () => {
  it('renders nothing when no zone is selected', () => {
    const { container } = render(
      <BottomToolbar
        zone={null}
        onConfigChange={jest.fn()}
        onBringForward={jest.fn()}
        onSendBack={jest.fn()}
        onDuplicate={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('increase font size fires onConfigChange with +2 of the current size', () => {
    const { onConfigChange } = setup({ defaultConfig: { fontSize: 24 } });
    fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ fontSize: 26 });
  });

  it('decrease font size fires onConfigChange with −2 of the current size', () => {
    const { onConfigChange } = setup({ defaultConfig: { fontSize: 24 } });
    fireEvent.click(screen.getByRole('button', { name: /decrease font size/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ fontSize: 22 });
  });

  it('decrease font size floors at 8px', () => {
    const { onConfigChange } = setup({ defaultConfig: { fontSize: 8 } });
    fireEvent.click(screen.getByRole('button', { name: /decrease font size/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ fontSize: 8 });
  });

  it('typing a font size in the number field fires onConfigChange with that value', () => {
    const { onConfigChange } = setup({ defaultConfig: { fontSize: 24 } });
    fireEvent.change(screen.getByRole('spinbutton', { name: /font size/i }), {
      target: { value: '72' },
    });
    expect(onConfigChange).toHaveBeenCalledWith({ fontSize: 72 });
  });

  it('the colour input fires onConfigChange with the picked colour', () => {
    const { onConfigChange } = setup({ defaultConfig: { color: '#1e293b' } });
    fireEvent.change(screen.getByLabelText(/text color/i), {
      target: { value: '#ff0000' },
    });
    expect(onConfigChange).toHaveBeenCalledWith({ color: '#ff0000' });
  });

  it('bold toggles config.bold', () => {
    const { onConfigChange } = setup({ defaultConfig: { bold: false } });
    fireEvent.click(screen.getByRole('button', { name: /^bold$/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ bold: true });
  });

  it('alignment cycles left → center', () => {
    const { onConfigChange } = setup({ defaultConfig: { textAlign: 'left' } });
    fireEvent.click(screen.getByRole('button', { name: /align: left/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ textAlign: 'center', alignment: 'center' });
  });

  it('uses the measured font size as the +/− anchor when config has none', () => {
    const { onConfigChange } = setup({ defaultConfig: {} }, { measuredFontSize: 180 });
    fireEvent.click(screen.getByRole('button', { name: /increase font size/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ fontSize: 182 });
  });

  it('layer / duplicate / delete actions fire their callbacks', () => {
    const { onBringForward, onSendBack, onDuplicate, onDelete } = setup();
    fireEvent.click(screen.getByRole('button', { name: /bring forward/i }));
    fireEvent.click(screen.getByRole('button', { name: /send back/i }));
    fireEvent.click(screen.getByRole('button', { name: /duplicate/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onBringForward).toHaveBeenCalledTimes(1);
    expect(onSendBack).toHaveBeenCalledTimes(1);
    expect(onDuplicate).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides typography controls for non-text widgets but keeps universal actions', () => {
    setup({ widgetType: 'IMAGE', defaultConfig: {} });
    // No font-size stepper for an image zone…
    expect(screen.queryByRole('spinbutton', { name: /font size/i })).toBeNull();
    // …but duplicate / delete are still there.
    expect(screen.getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
