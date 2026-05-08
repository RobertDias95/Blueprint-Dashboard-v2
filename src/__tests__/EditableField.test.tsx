import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import EditableField from '../components/EditableField';

// Q3: EditableField behavior — save-on-blur if value changed, no-op if
// unchanged, Escape reverts, Enter commits.

describe('<EditableField />', () => {
  it('calls onSave with the new value when the input blurs after a change', () => {
    const onSave = vi.fn();
    render(
      <EditableField
        kind="date"
        label="Target Submit"
        value="2026-01-15"
        onSave={onSave}
        testId="ts"
      />,
    );
    const input = screen.getByTestId('ts') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-02-01' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('2026-02-01');
  });

  it('does NOT call onSave when blur happens without an actual change', () => {
    const onSave = vi.fn();
    render(
      <EditableField
        kind="text"
        label="DA"
        value="Trevor"
        onSave={onSave}
        testId="da"
      />,
    );
    const input = screen.getByTestId('da') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Escape reverts the draft and does not save', () => {
    const onSave = vi.fn();
    render(
      <EditableField
        kind="text"
        label="DM"
        value="Brittani"
        onSave={onSave}
        testId="dm"
      />,
    );
    const input = screen.getByTestId('dm') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Lindsay' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe('Brittani');
  });

  it('select kind commits immediately on change', () => {
    const onSave = vi.fn();
    render(
      <EditableField
        kind="select"
        label="Stage"
        value=""
        options={[
          { value: '', label: 'Auto' },
          { value: 'pm', label: 'Permitting' },
        ]}
        onSave={onSave}
        testId="stage"
      />,
    );
    const select = screen.getByTestId('stage') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'pm' } });
    expect(onSave).toHaveBeenCalledWith('pm');
  });

  it('disables the input + hides spinner when saving=false', () => {
    render(
      <EditableField
        kind="text"
        label="DA"
        value="Trevor"
        onSave={() => {}}
        testId="da2"
      />,
    );
    expect(screen.queryByTestId('da2-saving')).toBeNull();
  });

  it('shows the saving spinner when saving=true', () => {
    render(
      <EditableField
        kind="text"
        label="DA"
        value="Trevor"
        onSave={() => {}}
        saving
        testId="da3"
      />,
    );
    expect(screen.getByTestId('da3-saving')).toBeInTheDocument();
    expect(screen.getByTestId('da3')).toBeDisabled();
  });
});
