import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CommandBarTrigger from './CommandBarTrigger';

describe('CommandBarTrigger', () => {
  it('opens the palette from the search field', () => {
    const onOpen = vi.fn();
    render(<CommandBarTrigger onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: /search or jump to/i }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('offers a one-click route into AI mode', () => {
    // Reaching AI mode used to take two deliberate actions — open the palette,
    // then find and click the toggle inside it. That is two too many for the
    // thing somebody came to the search bar to do.
    const onOpen = vi.fn();
    const onOpenAi = vi.fn();
    render(<CommandBarTrigger onOpen={onOpen} onOpenAi={onOpenAi} />);

    fireEvent.click(screen.getByRole('button', { name: /ask ai about your data/i }));

    expect(onOpenAi).toHaveBeenCalledTimes(1);
    // The two entry points are distinct: opening in AI mode must not also fire
    // the plain open, or the palette would receive two conflicting intents.
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('does not advertise AI where there is none', () => {
    // The chip is rendered only when a handler is supplied, so a surface
    // without AI mode does not show a control that would do nothing.
    render(<CommandBarTrigger onOpen={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /ask ai/i })).not.toBeInTheDocument();
  });

  it('keeps both controls clickable', () => {
    // A button nested inside a button is invalid HTML, and browsers resolve it
    // by dropping the inner one — which would make the AI chip unclickable
    // while still looking like a control.
    const onOpen = vi.fn();
    const onOpenAi = vi.fn();
    render(<CommandBarTrigger onOpen={onOpen} onOpenAi={onOpenAi} />);

    fireEvent.click(screen.getByRole('button', { name: /search or jump to/i }));
    fireEvent.click(screen.getByRole('button', { name: /ask ai about your data/i }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpenAi).toHaveBeenCalledTimes(1);
  });
});
