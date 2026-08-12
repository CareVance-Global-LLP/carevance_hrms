import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from './dialogStack';
import SlideOver from './SlideOver';

afterEach(() => {
  resetDialogStack();
});

describe('SlideOver', () => {
  it('renders nothing while closed', () => {
    render(
      <SlideOver open={false} title="Employee" onClose={vi.fn()}>
        <p>Body</p>
      </SlideOver>,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('exposes a dialog named by its title', () => {
    render(
      <SlideOver open title="Employee" onClose={vi.fn()}>
        <p>Body</p>
      </SlideOver>,
    );

    expect(screen.getByRole('dialog', { name: 'Employee' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideOver open title="Employee" onClose={onClose}>
        <p>Body</p>
      </SlideOver>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the panel', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Outside</button>
        <SlideOver open title="Employee" onClose={vi.fn()}>
          <button type="button">Inside</button>
        </SlideOver>
      </div>,
    );

    screen.getByRole('button', { name: 'Inside' }).focus();
    await user.tab();

    expect(screen.getByRole('button', { name: 'Outside' })).not.toHaveFocus();
  });

  it('does not lose focus while typing, with an inline onClose', async () => {
    // The bug this drawer was written around: an inline onClose changed
    // identity every render, the focus effect re-ran on each keystroke, and
    // only the first character ever landed in the field.
    const user = userEvent.setup();
    render(
      <SlideOver open title="Employee" onClose={() => undefined}>
        <input aria-label="Note" />
      </SlideOver>,
    );

    const input = screen.getByLabelText('Note');
    await user.click(input);
    await user.type(input, 'abcdef');

    expect(input).toHaveValue('abcdef');
  });
});
