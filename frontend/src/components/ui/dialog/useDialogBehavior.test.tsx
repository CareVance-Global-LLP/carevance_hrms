import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDialogStack } from './dialogStack';
import { DialogDepthProvider, useDialogBehavior } from './useDialogBehavior';

afterEach(() => {
  resetDialogStack();
});

function Dialog({
  open,
  onClose,
  busy = false,
  dismissOnBackdrop = true,
  testId = 'backdrop',
  children,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  const { panelRef, backdropProps, panelProps, zIndex, depth } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
  });

  if (!open) return null;

  return (
    <div data-testid={testId} style={{ zIndex }} {...backdropProps}>
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Test dialog"
        data-testid={`${testId}-panel`}
        {...panelProps}
      >
        <DialogDepthProvider value={depth}>{children}</DialogDepthProvider>
      </div>
    </div>
  );
}

describe('useDialogBehavior focus', () => {
  it('moves focus to the panel rather than the first control', () => {
    // Landing on a destructive button means a stray Enter fires it.
    render(
      <Dialog open onClose={vi.fn()}>
        <button type="button">Delete everything</button>
      </Dialog>,
    );

    expect(screen.getByTestId('backdrop-panel')).toHaveFocus();
  });

  it('returns focus to the element that was focused before opening', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog open={open} onClose={() => setOpen(false)} />
        </div>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });

    await user.click(trigger);
    expect(screen.getByTestId('backdrop-panel')).toHaveFocus();

    await user.keyboard('{Escape}');

    expect(trigger).toHaveFocus();
  });

  it('does not re-run the focus effect when onClose gets a new identity', async () => {
    // SlideOver hit this: callers pass inline arrows, so onClose changed on
    // every render. With onClose in the dependency array the effect re-ran on
    // each keystroke and pulled focus out of the field being typed into, so
    // only the first character ever landed.
    function Harness() {
      const [text, setText] = useState('');
      return (
        <Dialog open onClose={() => setText('')}>
          <input aria-label="Note" value={text} onChange={(event) => setText(event.target.value)} />
        </Dialog>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const input = screen.getByLabelText('Note');

    await user.click(input);
    await user.type(input, 'hello');

    expect(input).toHaveValue('hello');
    expect(input).toHaveFocus();
  });
});

describe('useDialogBehavior keyboard', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while busy so an in-flight save is not discarded', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog open busy onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only the top dialog when two are open', async () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();
    const user = userEvent.setup();

    render(
      <Dialog open onClose={onCloseOuter} testId="outer">
        <Dialog open onClose={onCloseInner} testId="inner" />
      </Dialog>,
    );

    await user.keyboard('{Escape}');

    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('stacks z-index by depth', () => {
    render(
      <Dialog open onClose={vi.fn()} testId="outer">
        <Dialog open onClose={vi.fn()} testId="inner" />
      </Dialog>,
    );

    expect(screen.getByTestId('outer')).toHaveStyle({ zIndex: '50' });
    expect(screen.getByTestId('inner')).toHaveStyle({ zIndex: '60' });
  });

  it('cycles Tab from the last control back to the first', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    last.focus();
    await user.tab();

    expect(first).toHaveFocus();
  });

  it('cycles Shift+Tab from the first control back to the last', async () => {
    const user = userEvent.setup();
    render(
      <Dialog open onClose={vi.fn()}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </Dialog>,
    );

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    first.focus();
    await user.tab({ shift: true });

    expect(last).toHaveFocus();
  });
});

describe('useDialogBehavior backdrop dismissal', () => {
  it('closes when a press and release both land on the backdrop', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} />);
    const backdrop = screen.getByTestId('backdrop');

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when a drag starts inside the panel and ends on the backdrop', () => {
    // Selecting text in the panel and releasing outside it should not throw
    // away the dialog. stopPropagation on the panel does not cover this.
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose}>
        <p>Some text the user is selecting</p>
      </Dialog>,
    );

    fireEvent.pointerDown(screen.getByTestId('backdrop-panel'));
    fireEvent.pointerUp(screen.getByTestId('backdrop'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop press while busy', () => {
    const onClose = vi.fn();
    render(<Dialog open busy onClose={onClose} />);
    const backdrop = screen.getByTestId('backdrop');

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close on backdrop press when dismissOnBackdrop is false', () => {
    const onClose = vi.fn();
    render(<Dialog open dismissOnBackdrop={false} onClose={onClose} />);
    const backdrop = screen.getByTestId('backdrop');

    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);

    expect(onClose).not.toHaveBeenCalled();
  });
});
