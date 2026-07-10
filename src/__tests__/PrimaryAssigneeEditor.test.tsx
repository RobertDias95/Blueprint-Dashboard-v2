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

  it('fix-229: default (unset) shows the DA ONCE via the select (no duplicate chip)', () => {
    render(
      <PrimaryAssigneeEditor
        value={null}
        ctx={ctx}
        memberNames={['Jade']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const sel = screen.getByTestId('t-primary-select') as HTMLSelectElement;
    expect(sel.value).toBe('Design Associate');
    // The selected option carries the resolved person ("Design Associate · Jade").
    expect(sel.selectedOptions[0].textContent).toContain('Jade');
    // No separate resolved-person chip in edit mode.
    expect(screen.queryByTestId('t-primary')).toBeNull();
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
    expect((screen.getByTestId('t-primary-select') as HTMLSelectElement).value).toBe('Gone');
  });

  it('fix-231: a person a role option resolves to is listed ONCE (the role-labeled one), not twice', () => {
    // Miles is the ENT lead (Entitlements → Miles) AND is in the roster — the
    // pre-fix-231 bug listed Miles twice ("Entitlements · Miles" + bare "Miles").
    render(
      <PrimaryAssigneeEditor
        value={null}
        ctx={ctx}
        memberNames={['Jade', 'Miles', 'Erick']}
        onChange={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const select = screen.getByTestId('t-primary-select') as HTMLSelectElement;
    const options = Array.from(select.options);
    // Miles appears in exactly one option, and it is the role-labeled one.
    const milesOptions = options.filter((o) => (o.textContent ?? '').includes('Miles'));
    expect(milesOptions.map((o) => o.textContent)).toEqual(['Entitlements · Miles']);
    // No bare "Miles" person option survives (value would be 'Miles').
    expect(options.map((o) => o.value)).not.toContain('Miles');
    // A roster person NOT covered by any role is still offered bare.
    expect(options.map((o) => o.value)).toContain('Erick');
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
