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

  it('add inserts an empty row at the end', () => {
    const onChange = vi.fn();
    const value: UnitType[] = [
      { label: 'A', width_ft: 10, depth_ft: 20, qty: 1 },
    ];
    render(<UnitTypesEditor value={value} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('unit-types-add'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as UnitType[];
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({
      label: '',
      width_ft: null,
      depth_ft: null,
      qty: 0,
    });
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
