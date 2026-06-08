import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ComparePanel from '../components/shared/ComparePanel';

// fix-137-b: ComparePanel — inline (not a modal), opens below the
// AddComparisonButton. Preset shortcuts fill both periods in one click;
// manual edit + Apply commits.

const TODAY = new Date('2026-05-15T12:00:00Z');

describe('<ComparePanel /> — fix-137-b', () => {
  it('closed → renders nothing', () => {
    const { container } = render(
      <ComparePanel
        open={false}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('open → header, preset row, Period A/B pickers, Apply, Cancel', () => {
    render(
      <ComparePanel
        open={true}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    expect(screen.getByTestId('p')).toBeInTheDocument();
    expect(screen.getByTestId('p-presets')).toBeInTheDocument();
    expect(screen.getByTestId('p-period-a-from')).toBeInTheDocument();
    expect(screen.getByTestId('p-period-a-to')).toBeInTheDocument();
    expect(screen.getByTestId('p-period-b-from')).toBeInTheDocument();
    expect(screen.getByTestId('p-period-b-to')).toBeInTheDocument();
    expect(screen.getByTestId('p-apply')).toBeInTheDocument();
    expect(screen.getByTestId('p-cancel')).toBeInTheDocument();
  });

  it('opens with Period A pre-filled from primaryRange', () => {
    render(
      <ComparePanel
        open={true}
        primaryRange={{ from: '2026-04-01', to: '2026-04-30' }}
        comparisonRange={null}
        today={TODAY}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    expect(
      (screen.getByTestId('p-period-a-from') as HTMLInputElement).value,
    ).toBe('2026-04-01');
    expect(
      (screen.getByTestId('p-period-a-to') as HTMLInputElement).value,
    ).toBe('2026-04-30');
    // Period B empty when no existing comparison.
    expect(
      (screen.getByTestId('p-period-b-from') as HTMLInputElement).value,
    ).toBe('');
  });

  it('Apply disabled while either period is incomplete; enabled when both filled', () => {
    render(
      <ComparePanel
        open={true}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    const apply = screen.getByTestId('p-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    // Fill Period A.
    fireEvent.change(screen.getByTestId('p-period-a-from'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByTestId('p-period-a-to'), {
      target: { value: '2026-04-30' },
    });
    expect(apply.disabled).toBe(true);
    // Period B partially filled — still disabled.
    fireEvent.change(screen.getByTestId('p-period-b-from'), {
      target: { value: '2026-03-01' },
    });
    expect(apply.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('p-period-b-to'), {
      target: { value: '2026-03-31' },
    });
    expect(apply.disabled).toBe(false);
  });

  it('clicking "This quarter vs last" preset fills BOTH Period A and Period B', () => {
    render(
      <ComparePanel
        open={true}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={vi.fn()}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p-preset-this_quarter_vs_last'));
    expect(
      (screen.getByTestId('p-period-a-from') as HTMLInputElement).value,
    ).toBe('2026-04-01');
    expect(
      (screen.getByTestId('p-period-a-to') as HTMLInputElement).value,
    ).toBe('2026-06-30');
    expect(
      (screen.getByTestId('p-period-b-from') as HTMLInputElement).value,
    ).toBe('2026-01-01');
    expect(
      (screen.getByTestId('p-period-b-to') as HTMLInputElement).value,
    ).toBe('2026-03-31');
  });

  it('Apply fires onApply with the right (periodA, periodB) tuple', () => {
    const onApply = vi.fn();
    render(
      <ComparePanel
        open={true}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={onApply}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p-preset-this_quarter_vs_last'));
    fireEvent.click(screen.getByTestId('p-apply'));
    expect(onApply).toHaveBeenCalledWith(
      { from: '2026-04-01', to: '2026-06-30' },
      { from: '2026-01-01', to: '2026-03-31' },
    );
  });

  it('Cancel fires onCancel without applying', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <ComparePanel
        open={true}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={onApply}
        onCancel={onCancel}
        testIdPrefix="p"
      />,
    );
    fireEvent.click(screen.getByTestId('p-preset-this_quarter_vs_last'));
    fireEvent.click(screen.getByTestId('p-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('Escape key dismisses', () => {
    const onCancel = vi.fn();
    render(
      <ComparePanel
        open={true}
        primaryRange={null}
        comparisonRange={null}
        today={TODAY}
        onApply={vi.fn()}
        onCancel={onCancel}
        testIdPrefix="p"
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Enter on a Period B input triggers Apply when valid', () => {
    const onApply = vi.fn();
    render(
      <ComparePanel
        open={true}
        primaryRange={{ from: '2026-04-01', to: '2026-04-30' }}
        comparisonRange={null}
        today={TODAY}
        onApply={onApply}
        onCancel={vi.fn()}
        testIdPrefix="p"
      />,
    );
    fireEvent.change(screen.getByTestId('p-period-b-from'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.change(screen.getByTestId('p-period-b-to'), {
      target: { value: '2026-03-31' },
    });
    fireEvent.keyDown(screen.getByTestId('p-period-b-to'), { key: 'Enter' });
    expect(onApply).toHaveBeenCalledWith(
      { from: '2026-04-01', to: '2026-04-30' },
      { from: '2026-03-01', to: '2026-03-31' },
    );
  });
});
