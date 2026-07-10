import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import BugReport from './BugReport';

const INDEX_CSS = readFileSync('src/index.css', 'utf8');

const { captureSpy, submitSpy, blobToDataUrlSpy, buildInputSpy } = vi.hoisted(() => ({
  captureSpy: vi.fn(),
  submitSpy: vi.fn(),
  blobToDataUrlSpy: vi.fn(),
  buildInputSpy: vi.fn((value) => ({ ...value, schemaVersion: 1 })),
}));

vi.mock('../data/bugReports', () => ({
  BUG_REPORT_DESCRIPTION_MAX: 4000,
  captureAppSurface: captureSpy,
  submitBugReport: submitSpy,
  blobToDataUrl: blobToDataUrlSpy,
  buildBugReportInput: buildInputSpy,
}));

beforeEach(() => {
  captureSpy.mockReset();
  submitSpy.mockReset();
  blobToDataUrlSpy.mockReset();
  buildInputSpy.mockClear();
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:preview'),
    revokeObjectURL: vi.fn(),
  });
});

describe('W4 bug-report inbox', () => {
  it('pins responsive, safe-area, install-prompt, and modal-suppression CSS contracts', () => {
    const css = INDEX_CSS;
    expect(css).toMatch(/\.bug-report-trigger\s*\{[^}]*right:\s*max\(12px, env\(safe-area-inset-right\)\)/s);
    expect(css).toMatch(/bottom:\s*calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/body\.install-prompt-visible \.bug-report-trigger/);
    expect(css).toMatch(/body:has\(\.celebrate\) \.bug-report-trigger/);
    expect(css).toMatch(/body:has\(\.sheet-backdrop\) \.bug-report-trigger/);
    expect(css).toMatch(/@media \(max-width: 520px\)[\s\S]*\.bug-report-trigger span/);
  });

  it('renders a persistent accessible utility control, not a navigation link', () => {
    render(<BugReport />);
    const trigger = screen.getByRole('button', { name: 'Report a bug' });
    expect(trigger).toHaveClass('bug-report-trigger');
    expect(screen.queryByRole('link', { name: 'Report a bug' })).not.toBeInTheDocument();
  });

  it('captures the app surface on open and previews the image before submission', async () => {
    captureSpy.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    render(<BugReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    expect(await screen.findByRole('dialog', { name: 'Report a bug' })).toBeInTheDocument();
    expect(await screen.findByAltText('Screenshot that will be submitted with this bug report')).toHaveAttribute('src', 'blob:preview');
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('allows text-only submission after capture fails and returns a receipt id', async () => {
    captureSpy.mockRejectedValue(new Error('Canvas unavailable'));
    submitSpy.mockResolvedValue({ reportId: 'report-123' });
    render(<BugReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    expect(await screen.findByText(/Screenshot unavailable/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'The card froze after I marked a square.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(submitSpy).toHaveBeenCalledTimes(1));
    expect(buildInputSpy).toHaveBeenCalledWith({
      description: 'The card froze after I marked a square.',
      screenshotDataUrl: null,
      captureError: 'Canvas unavailable',
    });
    expect(await screen.findByText('report-123')).toBeInTheDocument();
  });

  it('encodes an approved screenshot and keeps the sheet open on a retryable submit error', async () => {
    const screenshot = new Blob(['png'], { type: 'image/png' });
    captureSpy.mockResolvedValue(screenshot);
    blobToDataUrlSpy.mockResolvedValue('data:image/png;base64,abc');
    submitSpy.mockRejectedValue({ code: 'functions/unavailable' });
    render(<BugReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    await screen.findByAltText('Screenshot that will be submitted with this bug report');
    fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Ranks did not update.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not submit');
    expect(blobToDataUrlSpy).toHaveBeenCalledWith(screenshot);
    expect(screen.getByRole('dialog', { name: 'Report a bug' })).toBeInTheDocument();
  });

  it('closes with Escape and restores focus to the persistent trigger', async () => {
    captureSpy.mockRejectedValue(new Error('Capture unavailable'));
    render(<BugReport />);
    const trigger = screen.getByRole('button', { name: 'Report a bug' });
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Report a bug' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Report a bug' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('ignores a stale capture that finishes after the sheet is closed', async () => {
    let resolveCapture!: (image: Blob) => void;
    captureSpy.mockReturnValue(new Promise<Blob>((resolve) => { resolveCapture = resolve; }));
    render(<BugReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    await screen.findByRole('dialog', { name: 'Report a bug' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    resolveCapture(new Blob(['late'], { type: 'image/png' }));
    await Promise.resolve();
    expect(screen.queryByAltText('Screenshot that will be submitted with this bug report')).not.toBeInTheDocument();
  });

  it('traps keyboard focus within the modal sheet', async () => {
    captureSpy.mockRejectedValue(new Error('Capture unavailable'));
    render(<BugReport />);
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }));
    await screen.findByText(/Screenshot unavailable/);
    const textarea = screen.getByLabelText('What happened?');
    fireEvent.change(textarea, { target: { value: 'The board froze.' } });
    const send = screen.getByRole('button', { name: 'Send report' });
    expect(send).toBeEnabled();
    send.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(textarea).toHaveFocus();
    textarea.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(send).toHaveFocus();
  });
});
