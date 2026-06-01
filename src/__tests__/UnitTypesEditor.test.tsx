import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UnitTypesEditor from '../components/wizard/UnitTypesEditor';
import type { UnitType } from '../lib/database.types';

describe('<UnitTypesEditor />', () => {
  it('renders an empty-state when value is []', () => {
    const onChange = vi.fn();
    render(<UnitTypesEditor value={[]} onChange={onChange} />);
    expect(screen.getByText(/No unit types yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('unit-types-row-0')).toBeNull();
  });

  it('renders one row per entry with editable fields', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: '16×40 4BR', width_ft: 16, depth_ft: 40, qty: 3 },
      { label: '20×40 5BR', width_ft: 20, depth_ft: 40, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    expect(screen.getByTestId('unit-types-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('unit-types-row-1')).toBeInTheDocument();
    expect(
      (screen.getByTestId('unit-types-label-0') as HTMLInputElement).value,
    ).toBe('16×40 4BR');
    expect(
      (screen.getByTestId('unit-types-qty-1') as HTMLInputElement).value,
    ).toBe('1');
  });

  it('+ Add on an empty list lands "Type A"', () => {
    const onChange = vi.fn();
    render(<UnitTypesEditor value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      label: 'Type A',
      width_ft: null,
      depth_ft: null,
      qty: 0,
    });
  });

  it('+ Add after Type A lands "Type B"', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'Type A', width_ft: 25, depth_ft: 60, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[1].label).toBe('Type B');
  });

  it('+ Add after [Type A, Type B] lands "Type C" (not "Type B" again)', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'Type A', width_ft: 25, depth_ft: 60, qty: 1 },
      { label: 'Type B', width_ft: 30, depth_ft: 70, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[2].label).toBe('Type C');
  });

  it('deleting Type B from [A, B, C] then + Add reuses "Type B"', () => {
    // The component receives `value` from the parent, so the test
    // mounts twice: once with [A, B, C] to fire the remove, then with
    // the post-remove [A, C] to fire the add. This mirrors how the
    // parent threads onChange→state→value back to the child.
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'Type A', width_ft: 25, depth_ft: 60, qty: 1 },
      { label: 'Type B', width_ft: 30, depth_ft: 70, qty: 1 },
      { label: 'Type C', width_ft: 35, depth_ft: 80, qty: 1 },
    ];
    const { rerender } = render(
      <UnitTypesEditor value={value} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('unit-types-remove-1'));
    const afterRemove = onChange.mock.calls[0][0] as UnitType[];
    expect(afterRemove.map((u) => u.label)).toEqual(['Type A', 'Type C']);

    onChange.mockClear();
    rerender(<UnitTypesEditor value={afterRemove} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const afterAdd = onChange.mock.calls[0][0] as UnitType[];
    expect(afterAdd[afterAdd.length - 1].label).toBe('Type B');
  });

  it('+ Add after a full A-Z lands "Type AA" (Excel-style overflow)', () => {
    const onChange = vi.fn();
    const value: UnitType[] = Array.from({ length: 26 }, (_, i) => ({
      label: `Type ${String.fromCharCode(65 + i)}`,
      width_ft: null,
      depth_ft: null,
      qty: 1,
    }));
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[next.length - 1].label).toBe('Type AA');
  });

  it('renaming "Type A" → "Cottage 1" fires onChange with the new label', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'Type A', width_ft: 25, depth_ft: 60, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('unit-types-label-0'), {
      target: { value: 'Cottage 1' },
    });
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].label).toBe('Cottage 1');
  });

  it('renamed rows don\'t consume a Type-letter (+ Add still picks the next vacant letter)', () => {
    const onChange = vi.fn();
    // Type A renamed to "Cottage 1", Type B left alone. Next letter
    // should be C (Cottage 1 is invisible to the pool); confirms a
    // freeform rename doesn't shift the auto-naming.
    const value: UnitType[] = [
      { label: 'Cottage 1', width_ft: 25, depth_ft: 60, qty: 1 },
      { label: 'Type B', width_ft: 30, depth_ft: 70, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    // "Cottage 1" doesn't match /^Type [A-Z]+$/ → only Type B is in
    // the used-set → next free letter is A.
    expect(next[next.length - 1].label).toBe('Type A');
  });

  it('remove drops the row at the given index', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'A', width_ft: 10, depth_ft: 20, qty: 1 },
      { label: 'B', width_ft: 12, depth_ft: 22, qty: 2 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-remove-0'));
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next).toEqual([{ label: 'B', width_ft: 12, depth_ft: 22, qty: 2 }]);
  });

  it('editing the label fires onChange with the updated row', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'A', width_ft: 10, depth_ft: 20, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('unit-types-label-0'), {
      target: { value: 'A-prime' },
    });
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].label).toBe('A-prime');
  });

  it('clearing width writes null (not 0) so DB keeps clean NULLs', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'A', width_ft: 16, depth_ft: 40, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('unit-types-width-0'), {
      target: { value: '' },
    });
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].width_ft).toBeNull();
  });

  it('qty clamps to 0 when a negative value is entered', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'A', width_ft: 16, depth_ft: 40, qty: 3 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('unit-types-qty-0'), {
      target: { value: '-2' },
    });
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next[0].qty).toBe(0);
  });
});
