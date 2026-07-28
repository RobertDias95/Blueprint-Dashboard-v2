import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import BufferedDateInput from '../components/BufferedDateInput';

// fix-258: the shared buffered date input. A native <input type="date"> fires
// onChange on EVERY intermediate state, so wiring onChange to a mutation saves
// transient garbage. This is the third time that bug has been found (fix-73
// cycle dates, fix-237 task dates, fix-258 intake dates), hence one shared
// implementation with these tests as its contract.

function setup(initial: string | null = '2026-08-04') {
  const onCommit = vi.fn();
  render(
    <BufferedDateInput value={initial} onCommit={onCommit} testId="bdi" />,
  );
  return { onCommit, input: screen.getByTestId('bdi') as HTMLInputElement };
}

describe('BufferedDateInput — commit timing', () => {
  it('fires NO commit while the value is being typed', () => {
    // THE REGRESSION. On the pre-fix code every one of these fired a mutation.
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-07-04' } });
    fireEvent.change(input, { target: { value: '2026-07-14' } });
    fireEvent.change(input, { target: { value: '2026-08-14' } });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('the 7133442-CN scenario: passing through 2026-07-04 commits only 2026-08-04', () => {
    // Miles's recording: editing an intake date, the transient month-decremented
    // value got saved, the row fell outside the displayed week, and the permit
    // vanished from the list.
    const { onCommit, input } = setup('2026-08-11');
    fireEvent.change(input, { target: { value: '2026-07-04' } }); // transient
    fireEvent.change(input, { target: { value: '2026-08-04' } }); // intended
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-08-04');
    // The destructive intermediate never reached the server.
    expect(onCommit).not.toHaveBeenCalledWith('2026-07-04');
  });

  it('commits once on blur', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-09-01');
  });

  it('commits on Enter', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Enter routes through blur; jsdom fires it synchronously.
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('2026-09-01');
  });

  it('fires nothing when the value is unchanged', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('fires nothing when typing returns to the original value', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-07-04' } });
    fireEvent.change(input, { target: { value: '2026-08-04' } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits null when cleared', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it('does not re-commit on a second blur', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    fireEvent.blur(input);
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});

describe('BufferedDateInput — Escape reverts', () => {
  it('restores the committed value and commits nothing', () => {
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-07-04' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('2026-08-04');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a blur immediately after Escape cannot commit the escaped-out value', () => {
    // The ref exists for exactly this: a closure read would still hold the
    // pre-revert draft.
    const { onCommit, input } = setup('2026-08-04');
    fireEvent.change(input, { target: { value: '2026-01-01' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('BufferedDateInput — refetch safety', () => {
  /** Harness that lets a test push a new `value` prop mid-edit, the way a
   *  background refetch does. */
  function Harness({ onCommit }: { onCommit: (v: string | null) => void }) {
    const [value, setValue] = useState<string | null>('2026-08-04');
    return (
      <>
        <BufferedDateInput value={value} onCommit={onCommit} testId="bdi" />
        <button onClick={() => setValue('2026-12-25')} data-testid="refetch">
          refetch
        </button>
      </>
    );
  }

  it('a refetch arriving mid-edit does NOT clobber the draft', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByTestId('bdi') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '2026-09-09' } });
    // Server truth changes underneath the user, mid-edit.
    fireEvent.click(screen.getByTestId('refetch'));

    expect(input.value).toBe('2026-09-09');
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith('2026-09-09');
  });

  it('a refetch DOES sync the input when the user is not editing', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByTestId('bdi') as HTMLInputElement;

    fireEvent.click(screen.getByTestId('refetch'));
    expect(input.value).toBe('2026-12-25');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('after a refetch, blurring an untouched field commits nothing', () => {
    // lastCommittedRef must advance with the incoming value even while idle,
    // or the next blur would "re-commit" the stale value.
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    const input = screen.getByTestId('bdi') as HTMLInputElement;
    fireEvent.click(screen.getByTestId('refetch'));
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('BufferedDateInput — onEditEnd', () => {
  it('fires on blur even when the value did not change', () => {
    const onEditEnd = vi.fn();
    render(
      <BufferedDateInput
        value="2026-08-04"
        onCommit={() => {}}
        onEditEnd={onEditEnd}
        testId="bdi"
      />,
    );
    fireEvent.blur(screen.getByTestId('bdi'));
    expect(onEditEnd).toHaveBeenCalled();
  });
});
