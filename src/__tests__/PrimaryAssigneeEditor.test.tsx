import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PrimaryAssigneeEditor from '../components/PrimaryAssigneeEditor';
import type { PrimaryResolutionContext } from '../lib/taskTeam';

// fix-228: the shared PRIMARY-owner editor (permit bar + My Tasks). Resolves
// assigned_to → person via the fix-222 taxonomy; default = the DA.

const ctx: PrimaryResolutionContext = {
  da: 'Jade',
  entLead: 'Miles',
  dm: 'Derry',
  schematicDesigners: ['Shire'],
};

describe('PrimaryAssigneeEditor (fix-228)', () => {
  it('offers the taxonomy + roles, each labeled with the resolved person', () => {
    render(
      <PrimaryAssigneeEditor
        value={null}
        ctx={ctx}
        memberNames={['Jade', 'Erick']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const select = screen.getByTestId('t-primary-select') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining([
        'Design Associate',
        'Entitlements',
        'Schematic Team',
        'Design Manager',
        'Erick',
      ]),
    );
    // team options show who they resolve to
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain('Entitlements · Miles');
    expect(labels).toContain('Design Manager · Derry');
  });

  it('default (unset) shows the DA as the resolved primary + selects Design Associate', () => {
    render(
      <PrimaryAssigneeEditor
        value={null}
        ctx={ctx}
        memberNames={['Jade']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-primary').textContent).toBe('Jade');
    expect((screen.getByTestId('t-primary-select') as HTMLSelectElement).value).toBe(
      'Design Associate',
    );
  });

  it('picking a team key fires onChange with that key', () => {
    const onChange = vi.fn();
    render(
      <PrimaryAssigneeEditor
        value={null}
        ctx={ctx}
        memberNames={['Jade']}
        onChange={onChange}
        testIdPrefix="t"
      />,
    );
    fireEvent.change(screen.getByTestId('t-primary-select'), {
      target: { value: 'Entitlements' },
    });
    expect(onChange).toHaveBeenCalledWith('Entitlements');
  });

  it('shows an off-roster stored person as the selected value', () => {
    render(
      <PrimaryAssigneeEditor
        value={'Gone'}
        ctx={ctx}
        memberNames={['Jade']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-primary').textContent).toBe('Gone');
    expect((screen.getByTestId('t-primary-select') as HTMLSelectElement).value).toBe('Gone');
  });

  it('readOnly renders the chip but no select', () => {
    render(
      <PrimaryAssigneeEditor
        value={'Entitlements'}
        ctx={ctx}
        memberNames={['Jade']}
        onChange={vi.fn()}
        readOnly
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-primary').textContent).toBe('Miles');
    expect(screen.queryByTestId('t-primary-select')).toBeNull();
  });
});
