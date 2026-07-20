import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TaskDateField from '../components/TaskDateField';

// fix-237: the shared task date field must buffer keystrokes and commit only on
// blur/Enter. The old per-keystroke onChange fired a mutation → refetch that
// re-synced the controlled input mid-typing, clobbering a 4-digit year to
// "0002"/blank (Bobby's screen recording on the D&E/Permitting task rows).

describe('TaskDateField (fix-237 buffered commit)', () => {
  it('typing a full date (incl. 4-digit year) does NOT fire a mutation per keystroke', () => {
    const onChange = vi.fn();
    render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    const input = screen.getByTestId('tf') as HTMLInputElement;
    // Native date inputs land intermediate values as the user types; simulate a
    // couple of interim writes ending on a valid full date.
    fireEvent.change(input, { target: { value: '2026-06-00' } });
    fireEvent.change(input, { target: { value: '2026-06-01' } });
    // Buffered: nothing committed while editing.
    expect(onChange).not.toHaveBeenCalled();
    // The input still shows what the user typed — no mid-edit reset.
    expect(input.value).toBe('2026-06-01');
  });

  it('a background refetch (value prop change) does NOT overwrite the draft while dirty', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    const input = screen.getByTestId('tf') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-06-01' } });
    // Simulate a sibling save's invalidate → refetch pushing a stale value back.
    rerender(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    // The user's typed draft survives the refetch (the churn bug is gone).
    expect(input.value).toBe('2026-06-01');
  });

  it('blur commits the typed value once', () => {
    const onChange = vi.fn();
    render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    const input = screen.getByTestId('tf');
    fireEvent.change(input, { target: { value: '2026-06-01' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-06-01');
  });

  it('Enter commits the typed value once', () => {
    const onChange = vi.fn();
    render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    const input = screen.getByTestId('tf') as HTMLInputElement;
    // Real users have the field focused when they press Enter; the handler
    // routes Enter through blur() (dedupe + commit live in one place), which in
    // jsdom only fires onBlur when the element is the active element.
    input.focus();
    fireEvent.change(input, { target: { value: '2026-07-15' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('2026-07-15');
  });

  it('blur with no change is a no-op (no phantom mutation)', () => {
    const onChange = vi.fn();
    render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    fireEvent.blur(screen.getByTestId('tf'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clearing a set date commits null on blur', () => {
    const onChange = vi.fn();
    render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Start date"
        testId="tf"
      />,
    );
    const input = screen.getByTestId('tf');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('an empty date shows a muted "—" until clicked, then reveals the input', () => {
    render(
      <TaskDateField
        value={null}
        onChange={vi.fn()}
        ariaLabel="Start date"
        testId="tf"
      />,
    );
    const empty = screen.getByTestId('tf-empty');
    expect(empty.textContent).toBe('—');
    expect(screen.queryByTestId('tf')).toBeNull();
    fireEvent.click(empty);
    expect(screen.getByTestId('tf')).toBeInTheDocument();
  });

  it('a committed value flows in via the prop when the user is not editing', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TaskDateField
        value="2026-05-01"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    const input = screen.getByTestId('tf') as HTMLInputElement;
    expect(input.value).toBe('2026-05-01');
    // Not dirty → a fresh server value (e.g. after a successful save elsewhere)
    // updates the field.
    rerender(
      <TaskDateField
        value="2026-08-08"
        onChange={onChange}
        ariaLabel="Target date"
        testId="tf"
      />,
    );
    expect(input.value).toBe('2026-08-08');
  });
});
