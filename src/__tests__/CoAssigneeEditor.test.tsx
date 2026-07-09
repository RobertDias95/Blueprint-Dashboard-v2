import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoAssigneeEditor from '../components/CoAssigneeEditor';
import type { ResolutionContext } from '../lib/taskTeam';

// fix-224: the shared co-assignee editor used by My Tasks + the permit bar.

const ctx: ResolutionContext = {
  da: 'Trevor',
  dm: 'Lindsay', // DM paired with Trevor in dm_da_groups (already resolved)
  schematicDesigners: ['Ana'],
};

describe('CoAssigneeEditor (fix-224)', () => {
  it('renders a chip per co-assignee; a role token resolves to the person', () => {
    render(
      <CoAssigneeEditor
        values={['Miles', 'role:design_manager', 'role:schematic_designer']}
        ctx={ctx}
        memberNames={['Miles', 'Bo']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-co-assignee-Miles').textContent).toContain('Miles');
    // design_manager → Lindsay (via ctx.dm); schematic_designer → Ana.
    expect(
      screen.getByTestId('t-co-assignee-role:design_manager').textContent,
    ).toContain('Lindsay');
    expect(
      screen.getByTestId('t-co-assignee-role:schematic_designer').textContent,
    ).toContain('Ana');
    // not blank when non-empty
    expect(screen.queryByTestId('t-co-assignees-empty')).toBeNull();
  });

  it('shows "Unassigned" when the set is empty', () => {
    render(
      <CoAssigneeEditor
        values={[]}
        ctx={ctx}
        memberNames={['Miles']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-co-assignees-empty')).toBeInTheDocument();
  });

  it('adding a person replaces the whole set (append)', () => {
    const onChange = vi.fn();
    render(
      <CoAssigneeEditor
        values={['Miles']}
        ctx={ctx}
        memberNames={['Miles', 'Bo']}
        onChange={onChange}
        testIdPrefix="t"
      />,
    );
    fireEvent.change(screen.getByTestId('t-co-assignee-add'), {
      target: { value: 'Bo' },
    });
    expect(onChange).toHaveBeenCalledWith(['Miles', 'Bo']);
  });

  it('removing a chip drops that raw entry', () => {
    const onChange = vi.fn();
    render(
      <CoAssigneeEditor
        values={['Miles', 'Bo']}
        ctx={ctx}
        memberNames={['Miles', 'Bo']}
        onChange={onChange}
        testIdPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId('t-co-assignee-remove-Miles'));
    expect(onChange).toHaveBeenCalledWith(['Bo']);
  });

  // fix-228: a co-assignee equal to the PRIMARY owner is display-de-duped.
  it('hides a co-assignee chip that IS the primary, and keeps it out of the add picker', () => {
    const onChange = vi.fn();
    render(
      <CoAssigneeEditor
        values={['Miles', 'Bo']}
        ctx={ctx}
        memberNames={['Miles', 'Bo']}
        primaryPerson="Miles"
        onChange={onChange}
        testIdPrefix="t"
      />,
    );
    // Miles (the primary) is hidden; Bo still shows.
    expect(screen.queryByTestId('t-co-assignee-Miles')).toBeNull();
    expect(screen.getByTestId('t-co-assignee-Bo')).toBeInTheDocument();
    // The add picker no longer offers Miles.
    const opts = Array.from(
      (screen.getByTestId('t-co-assignee-add') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(opts).not.toContain('Miles');
  });

  it('de-dupe is display-only: removing the OTHER co-assignee keeps the primary in the stored set', () => {
    const onChange = vi.fn();
    render(
      <CoAssigneeEditor
        values={['Miles', 'Bo']}
        ctx={ctx}
        memberNames={['Miles', 'Bo']}
        primaryPerson="Miles"
        onChange={onChange}
        testIdPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId('t-co-assignee-remove-Bo'));
    // The stored set still contains Miles (hidden, not dropped).
    expect(onChange).toHaveBeenCalledWith(['Miles']);
  });

  it('readOnly hides the add picker + remove buttons', () => {
    render(
      <CoAssigneeEditor
        values={['Miles']}
        ctx={ctx}
        memberNames={['Miles']}
        onChange={vi.fn()}
        readOnly
        testIdPrefix="t"
      />,
    );
    expect(screen.queryByTestId('t-co-assignee-add')).toBeNull();
    expect(screen.queryByTestId('t-co-assignee-remove-Miles')).toBeNull();
  });
});
