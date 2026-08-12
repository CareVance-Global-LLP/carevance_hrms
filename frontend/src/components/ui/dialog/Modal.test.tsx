import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from './dialogStack';
import Modal from './Modal';

afterEach(() => {
  resetDialogStack();
});

describe('Modal', () => {
  it('renders nothing while closed', () => {
    render(
      <Modal open={false} onClose={vi.fn()} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes a dialog with an accessible name taken from title', () => {
    render(
      <Modal open onClose={vi.fn()} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Payroll settings' })).toBeInTheDocument();
  });

  it('takes its accessible name from an existing heading when given titleId', () => {
    render(
      <Modal open onClose={vi.fn()} titleId="bespoke-heading">
        <h2 id="bespoke-heading">Record as filed</h2>
      </Modal>,
    );

    expect(screen.getByRole('dialog', { name: 'Record as filed' })).toBeInTheDocument();
  });

  it('renders as an alertdialog when asked', () => {
    render(
      <Modal open role="alertdialog" onClose={vi.fn()} title="Delete run">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('alertdialog', { name: 'Delete run' })).toBeInTheDocument();
  });

  it('closes from the header close button', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Modal open onClose={onClose} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables the close button while busy', () => {
    render(
      <Modal open busy onClose={vi.fn()} title="Payroll settings">
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  });

  it('renders the footer', () => {
    render(
      <Modal open onClose={vi.fn()} title="Payroll settings" footer={<button type="button">Save</button>}>
        <p>Body</p>
      </Modal>,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('gives a dialog opened from inside another dialog the higher z-index', () => {
    render(
      <Modal open onClose={vi.fn()} title="Outer">
        <Modal open onClose={vi.fn()} title="Inner">
          <p>Nested body</p>
        </Modal>
      </Modal>,
    );

    // Query by name, not by index — portal append order is not guaranteed.
    const outer = screen.getByRole('dialog', { name: 'Outer' });
    const inner = screen.getByRole('dialog', { name: 'Inner' });

    // The backdrop carries the z-index; walk up from the panel.
    expect(outer.closest('[data-dialog-backdrop]')).toHaveStyle({ zIndex: '50' });
    expect(inner.closest('[data-dialog-backdrop]')).toHaveStyle({ zIndex: '60' });
  });
});
