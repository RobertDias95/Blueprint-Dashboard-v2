import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NpBlockEditPopup from '../components/NpBlockEditPopup';
import type { DaTimeBlock } from '../lib/database.types';

// Q6.2.f: smoke tests for the add/edit popover. Component is pure UI —
// no mocks needed; we verify the callback contract.

const SAMPLE_BLOCK: DaTimeBlock = {
  id: 'np_123',
  da_name: 'Trevor',
  type: 'Training',
  label: 'Style Guide',
  start_week: '2026-05-04',
  end_week: '2026-05-11',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-08T12:00:00Z',
};

describe('<NpBlockEditPopup /> Q6.2.f', () => {
  it('Add mode: header shows DA + week, default type is Vacation', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={onAdd}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('np-edit-popup').textContent).toMatch(
      /Trevor.*wk 5\/4/,
    );
    // Default ✓ marker on Vacation.
    expect(screen.getByTestId('np-popup-type-Vacation').textContent).toMatch(
      /✓/,
    );
  });

  it('Add: clicking Save fires onAdd with chosen type + custom label', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={onAdd}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-type-Training'));
    fireEvent.change(screen.getByTestId('np-popup-label'), {
      target: { value: 'Style Guide' },
    });
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onAdd).toHaveBeenCalledWith('Training', 'Style Guide');
    expect(onClose).toHaveBeenCalled();
  });

  it('Add: empty custom label fires onAdd with empty string (caller decides default)', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={onAdd}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onAdd).toHaveBeenCalledWith('Vacation', '');
  });

  it('Add: Enter in the label input submits', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={onAdd}
        onClose={onClose}
      />,
    );
    const input = screen.getByTestId('np-popup-label') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Custom' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith('Vacation', 'Custom');
  });

  it('Add: Escape closes without firing onAdd', () => {
    const onAdd = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={onAdd}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('np-popup-label'), { key: 'Escape' });
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Edit mode: pre-fills with the block type + label', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={SAMPLE_BLOCK}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('np-popup-type-Training').textContent).toMatch(
      /✓/,
    );
    expect(
      (screen.getByTestId('np-popup-label') as HTMLInputElement).value,
    ).toBe('Style Guide');
  });

  it('Edit: clicking Save fires onUpdate with patched fields', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={SAMPLE_BLOCK}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-type-Vacation'));
    fireEvent.change(screen.getByTestId('np-popup-label'), {
      target: { value: 'Beach' },
    });
    fireEvent.click(screen.getByTestId('np-popup-save'));
    expect(onUpdate).toHaveBeenCalledWith('Vacation', 'Beach');
    expect(onClose).toHaveBeenCalled();
  });

  it('Edit: Remove button fires onRemove + onClose', () => {
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();
    render(
      <NpBlockEditPopup
        mode="edit"
        block={SAMPLE_BLOCK}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId('np-popup-remove'));
    expect(onRemove).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('Edit: header shows DA + date span + current type', () => {
    render(
      <NpBlockEditPopup
        mode="edit"
        block={SAMPLE_BLOCK}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // 5/4 – 5/11 · Training
    expect(screen.getByTestId('np-edit-popup').textContent).toMatch(
      /Trevor.*5\/4.*5\/11.*Training/,
    );
  });

  it('Add: header omits Remove button (add mode only)', () => {
    render(
      <NpBlockEditPopup
        mode="add"
        daName="Trevor"
        weekKey="2026-05-04"
        onAdd={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('np-popup-remove')).not.toBeInTheDocument();
  });
});
