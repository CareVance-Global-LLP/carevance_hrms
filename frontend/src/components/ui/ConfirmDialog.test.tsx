import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';
import ConfirmDialog from './ConfirmDialog';

afterEach(() => {
  resetDialogStack();
});

const baseProps = {
  isOpen: true,
  title: 'Delete payroll run',
  message: 'This cannot be undone.',
  onConfirm: vi.fn(),
  onClose: vi.fn(),
};

describe('ConfirmDialog', () => {
  it('renders as an alertdialog named by its title', () => {
    render(<ConfirmDialog {...baseProps} />);

    expect(screen.getByRole('alertdialog', { name: 'Delete payroll run' })).toBeInTheDocument();
  });

  it('describes itself with the message', () => {
    render(<ConfirmDialog {...baseProps} />);

    expect(screen.getByRole('alertdialog')).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('does not put initial focus on the confirm button', () => {
    // A focused destructive button turns a stray Enter into a deletion.
    render(<ConfirmDialog {...baseProps} tone="danger" confirmLabel="Delete" />);

    expect(screen.getByRole('button', { name: 'Delete' })).not.toHaveFocus();
  });

  it('calls onConfirm from the confirm button', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} onConfirm={onConfirm} confirmLabel="Delete" />);

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while loading', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} onClose={onClose} isLoading />);

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...baseProps} isOpen={false} />);

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
