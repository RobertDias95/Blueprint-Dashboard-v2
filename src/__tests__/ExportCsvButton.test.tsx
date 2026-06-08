import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ExportCsvButton from '../components/shared/ExportCsvButton';

// fix-135-a: shared ExportCsvButton primitive. These tests pin the
// click handler wiring + the empty-state disabled affordance. The
// underlying rowsToCsv + downloadCsv helpers are already covered by
// reportCsv.test.ts; here we exercise the button-level UX.

describe('<ExportCsvButton /> — fix-135-a', () => {
  let createObjectURLSpy: ReturnType<typeof vi.fn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURLSpy = vi.fn(() => 'blob:fake-url');
    revokeObjectURLSpy = vi.fn();
    // jsdom doesn't implement URL.createObjectURL — stub it so the
    // download flow can run without throwing.
    (URL as unknown as { createObjectURL: typeof URL.createObjectURL }).createObjectURL =
      createObjectURLSpy as unknown as typeof URL.createObjectURL;
    (URL as unknown as { revokeObjectURL: typeof URL.revokeObjectURL }).revokeObjectURL =
      revokeObjectURLSpy as unknown as typeof URL.revokeObjectURL;
    // Stub anchor.click so the test can assert without jsdom navigating.
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('renders an enabled button with the default label', () => {
    const onExport = vi.fn(() => 'header\r\na,b,c');
    render(
      <ExportCsvButton
        filename="test.csv"
        onExport={onExport}
        testId="x-button"
      />,
    );
    const btn = screen.getByTestId('x-button');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toContain('Export CSV');
    expect(btn).not.toBeDisabled();
    expect(btn.getAttribute('data-disabled')).toBe('false');
  });

  it('clicking calls onExport and triggers a download', () => {
    const onExport = vi.fn(() => 'header\r\nfoo,bar');
    render(
      <ExportCsvButton
        filename="myreport.csv"
        onExport={onExport}
        testId="x-button"
      />,
    );
    fireEvent.click(screen.getByTestId('x-button'));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURLSpy).toHaveBeenCalledTimes(1);
  });

  it('disabled prop short-circuits both onExport AND the download', () => {
    const onExport = vi.fn(() => 'header\r\na,b,c');
    render(
      <ExportCsvButton
        filename="test.csv"
        onExport={onExport}
        disabled={true}
        testId="x-button"
      />,
    );
    const btn = screen.getByTestId('x-button');
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('data-disabled')).toBe('true');
    expect(btn.getAttribute('title')).toBe('Nothing to export.');
    // The browser blocks click on a disabled button — but assert the
    // handler skip path too in case parent gates differ.
    fireEvent.click(btn);
    expect(onExport).not.toHaveBeenCalled();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('onExport returning empty string skips the download (defensive)', () => {
    const onExport = vi.fn(() => '');
    render(
      <ExportCsvButton
        filename="test.csv"
        onExport={onExport}
        testId="x-button"
      />,
    );
    fireEvent.click(screen.getByTestId('x-button'));
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  it('custom label renders in place of the default', () => {
    render(
      <ExportCsvButton
        filename="test.csv"
        onExport={() => 'data'}
        label="Download report"
        testId="x-button"
      />,
    );
    expect(screen.getByTestId('x-button').textContent).toBe(
      'Download report',
    );
  });
});
