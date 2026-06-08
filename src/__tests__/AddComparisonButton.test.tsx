import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AddComparisonButton from '../components/shared/AddComparisonButton';

// fix-137-b: AddComparisonButton — two visual states (Add button vs
// active-comparison chip) + parent-controlled open/close.

describe('<AddComparisonButton /> — fix-137-b', () => {
  it('closed + no comparison → renders "+ Add comparison" button', () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <AddComparisonButton
        isOpen={false}
        hasComparison={false}
        comparisonRange={null}
        onOpenChange={onOpen}
        onRemoveComparison={onRemove}
        testIdPrefix="t"
      />,
    );
    const btn = screen.getByTestId('t-add-button');
    expect(btn.textContent).toMatch(/Add comparison/);
    expect(btn.getAttribute('data-open')).toBe('false');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('t-chip')).toBeNull();
  });

  it('clicking the Add button calls onOpenChange(true)', () => {
    const onOpen = vi.fn();
    render(
      <AddComparisonButton
        isOpen={false}
        hasComparison={false}
        comparisonRange={null}
        onOpenChange={onOpen}
        onRemoveComparison={vi.fn()}
        testIdPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId('t-add-button'));
    expect(onOpen).toHaveBeenCalledWith(true);
  });

  it('isOpen=true → button reports aria-expanded=true + data-open=true', () => {
    render(
      <AddComparisonButton
        isOpen={true}
        hasComparison={false}
        comparisonRange={null}
        onOpenChange={vi.fn()}
        onRemoveComparison={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const btn = screen.getByTestId('t-add-button');
    expect(btn.getAttribute('data-open')).toBe('true');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('hasComparison=true → renders a chip showing the range with ✎ + × buttons', () => {
    render(
      <AddComparisonButton
        isOpen={false}
        hasComparison={true}
        comparisonRange={{ from: '2026-01-01', to: '2026-03-31' }}
        onOpenChange={vi.fn()}
        onRemoveComparison={vi.fn()}
        testIdPrefix="t"
      />,
    );
    const chip = screen.getByTestId('t-chip');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain('2026-01-01 – 2026-03-31');
    expect(screen.getByTestId('t-edit-button')).toBeInTheDocument();
    expect(screen.getByTestId('t-remove-button')).toBeInTheDocument();
    // No Add button when a comparison is already active.
    expect(screen.queryByTestId('t-add-button')).toBeNull();
  });

  it('clicking ✎ calls onOpenChange(!isOpen) to re-open the panel for editing', () => {
    const onOpen = vi.fn();
    render(
      <AddComparisonButton
        isOpen={false}
        hasComparison={true}
        comparisonRange={{ from: '2026-01-01', to: '2026-03-31' }}
        onOpenChange={onOpen}
        onRemoveComparison={vi.fn()}
        testIdPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId('t-edit-button'));
    expect(onOpen).toHaveBeenCalledWith(true);
  });

  it('clicking × calls onRemoveComparison', () => {
    const onRemove = vi.fn();
    render(
      <AddComparisonButton
        isOpen={false}
        hasComparison={true}
        comparisonRange={{ from: '2026-01-01', to: '2026-03-31' }}
        onOpenChange={vi.fn()}
        onRemoveComparison={onRemove}
        testIdPrefix="t"
      />,
    );
    fireEvent.click(screen.getByTestId('t-remove-button'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Add button when hasComparison=true but range is null (defensive)', () => {
    render(
      <AddComparisonButton
        isOpen={false}
        hasComparison={true}
        comparisonRange={null}
        onOpenChange={vi.fn()}
        onRemoveComparison={vi.fn()}
        testIdPrefix="t"
      />,
    );
    expect(screen.getByTestId('t-add-button')).toBeInTheDocument();
    expect(screen.queryByTestId('t-chip')).toBeNull();
  });
});
