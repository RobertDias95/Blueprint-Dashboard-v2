import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Builder } from '../lib/database.types';

// ===========================================================================
// ★★★ fix-448 §B (P-082) — THE PICK-ONLY BUILDER CELL
// ===========================================================================

const results = vi.hoisted(() => ({ current: [] as Builder[] }));
const upsertMutate = vi.hoisted(() => vi.fn());

vi.mock('../hooks/useBuilderSearch', () => ({
  useBuilderSearch: () => ({ data: results.current, isLoading: false }),
}));
vi.mock('../hooks/useBuilderRegistry', () => ({
  useUpsertBuilderRow: () => ({ mutate: upsertMutate, isPending: false }),
}));

import BuilderPicker from '../components/builder/BuilderPicker';

function b(over: Partial<Builder>): Builder {
  return {
    id: 'b1',
    name: 'Ted Chesledon',
    company: 'Cooper Thomas Homes, LLC',
    email: null,
    phone: null,
    address: null,
    notes: null,
    active: true,
    ...over,
  } as Builder;
}

const onPick = vi.fn();
const onCreated = vi.fn();
const onClear = vi.fn();

function renderPicker(value = '') {
  return render(
    <BuilderPicker
      value={value}
      onPick={onPick}
      onCreated={onCreated}
      onClear={onClear}
    />,
  );
}

beforeEach(() => {
  results.current = [];
  upsertMutate.mockReset();
  onPick.mockReset();
  onCreated.mockReset();
  onClear.mockReset();
});

describe('fix-448 §B: the picker', () => {
  it('★★★ results are GROUPED BY PERSON and each LLC is its own choice', () => {
    // Ruling 3: picking "Ted Chesledon" is not a choice anybody can act on;
    // picking "Ted Chesledon — Cooper Thomas Homes, LLC" is.
    results.current = [
      b({ id: 'a', name: 'Ted Chesledon', company: 'Cooper Thomas Homes, LLC' }),
      b({ id: 'b', name: 'Ted Chesledon', company: 'Cooper Thomas Homes' }),
      b({ id: 'c', name: 'Allan Cushing', company: 'Cushing Building Group, Inc.' }),
    ];
    renderPicker();
    const input = screen.getByTestId('pd-builder-picker');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'c' } });
    expect(screen.getByTestId('pd-builder-picker-group-Ted Chesledon')).toBeInTheDocument();
    expect(screen.getByTestId('pd-builder-picker-group-Allan Cushing')).toBeInTheDocument();
    const opt = screen.getByTestId('pd-builder-picker-option-a');
    expect(opt.textContent).toBe('Ted Chesledon — Cooper Thomas Homes, LLC');
    fireEvent.click(opt);
    expect(onPick).toHaveBeenCalledWith(results.current[0]);
  });

  it('★★★ blur without a pick reverts — nothing is written', () => {
    // ★★★ The guarantee, and it is absolute rather than a rule to remember:
    //     the typed text was a SEARCH, so it evaporates.
    results.current = [];
    renderPicker('Existing — Existing LLC');
    const input = screen.getByTestId('pd-builder-picker') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Brand New' } });
    fireEvent.blur(input);
    expect(onPick).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(upsertMutate).not.toHaveBeenCalled();
  });

  it('★★★ a DEACTIVATED row is not offered', () => {
    // Settings' Deactivate button has to mean something here, and
    // `useBuilderSearch` does not filter (confirmed on origin/main, despite a
    // comment elsewhere claiming it does).
    results.current = [
      b({ id: 'live', company: 'Live LLC' }),
      b({ id: 'dead', company: 'Retired LLC', active: false }),
    ];
    renderPicker();
    fireEvent.focus(screen.getByTestId('pd-builder-picker'));
    fireEvent.change(screen.getByTestId('pd-builder-picker'), {
      target: { value: 'll' },
    });
    expect(screen.getByTestId('pd-builder-picker-option-live')).toBeInTheDocument();
    expect(screen.queryByTestId('pd-builder-picker-option-dead')).toBeNull();
  });

  it('★★★ typing something new offers "Add new builder" and creating LINKS it', () => {
    results.current = [];
    renderPicker();
    const input = screen.getByTestId('pd-builder-picker');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Brand New Owner' } });
    const add = screen.getByTestId('pd-builder-picker-add-new');
    expect(add.textContent).toContain('Brand New Owner');
    fireEvent.click(add);
    // The dialog is pre-filled with what was typed.
    expect((screen.getByTestId('builder-add-name') as HTMLInputElement).value).toBe(
      'Brand New Owner',
    );
    fireEvent.change(screen.getByTestId('builder-add-company'), {
      target: { value: 'Brand New LLC' },
    });
    fireEvent.click(screen.getByTestId('builder-add-save'));
    expect(upsertMutate).toHaveBeenCalledTimes(1);
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({
      name: 'Brand New Owner',
      company: 'Brand New LLC',
    });
    // ★★ …and the row it creates is handed straight back to be linked.
    const created = b({ id: 'new', name: 'Brand New Owner', company: 'Brand New LLC' });
    upsertMutate.mock.calls[0][1].onSuccess(created);
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('★★★ when the PERSON already exists, the dialog asks only for the LLC', () => {
    // Ruling 3's other half: Ghennadi Ialanji already has rows; a fourth LLC
    // should not make you retype his name.
    results.current = [
      b({ id: 'g', name: 'Ghennadi Ialanji', company: 'Green Way Homes, LLC' }),
    ];
    renderPicker();
    const input = screen.getByTestId('pd-builder-picker');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Ghennadi Ialanji' } });
    const add = screen.getByTestId('pd-builder-picker-add-new');
    expect(add.textContent).toContain('Add a new LLC for Ghennadi Ialanji');
    fireEvent.click(add);
    const nameInput = screen.getByTestId('builder-add-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Ghennadi Ialanji');
    expect(nameInput.readOnly).toBe(true);
  });

  it('★★ the clear (×) only exists when something is linked', () => {
    const { unmount } = renderPicker('');
    expect(screen.queryByTestId('pd-builder-picker-clear')).toBeNull();
    unmount();
    renderPicker('Ted Chesledon — Cooper Thomas Homes, LLC');
    fireEvent.click(screen.getByTestId('pd-builder-picker-clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('★ the box shows the LINKED value when it is not being searched', () => {
    renderPicker('Ted Chesledon — Cooper Thomas Homes, LLC');
    const input = screen.getByTestId('pd-builder-picker') as HTMLInputElement;
    expect(input.value).toBe('Ted Chesledon — Cooper Thomas Homes, LLC');
  });
});
