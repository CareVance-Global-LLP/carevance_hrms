import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Gauge } from 'lucide-react';
import SidebarFlyout from './SidebarFlyout';

function Harness({ enabled = true, onPick }: { enabled?: boolean; onPick?: () => void }) {
  return (
    <div>
      <button type="button" data-testid="outside">
        elsewhere
      </button>

      <SidebarFlyout
        label="Monitoring"
        icon={Gauge}
        blurb="Activity, screenshots and usage"
        count={2}
        enabled={enabled}
        trigger={(props) => (
          <button type="button" data-testid="trigger" {...props} ref={props.ref as (n: HTMLButtonElement | null) => void}>
            Monitoring
          </button>
        )}
      >
        <a href="/monitoring" onClick={onPick}>
          Productive Time
        </a>
        <a href="/monitoring/screenshots" onClick={onPick}>
          Screenshots
        </a>
      </SidebarFlyout>
    </div>
  );
}

const trigger = () => screen.getByTestId('trigger');
const panel = () => screen.queryByRole('group', { name: /monitoring/i });

describe('SidebarFlyout opening', () => {
  it('stays closed until hovered', () => {
    render(<Harness />);
    expect(panel()).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on hover and lists the group’s items', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    expect(screen.getByRole('link', { name: 'Productive Time' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Screenshots' })).toBeInTheDocument();
  });

  it('keeps the group name as the panel heading, so nothing the tooltip said is lost', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.hover(trigger());
    await waitFor(() => expect(panel()).toHaveAccessibleName('Monitoring'));
  });

  it('says what the section is for, and how many things are in it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    expect(screen.getByText('Activity, screenshots and usage')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('omits the description cleanly when a group has none', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <SidebarFlyout
          label="Assets"
          icon={Gauge}
          trigger={(props) => (
            <button type="button" data-testid="trigger" {...props} ref={props.ref as (n: HTMLButtonElement | null) => void}>
              Assets
            </button>
          )}
        >
          <a href="/assets">Assets</a>
        </SidebarFlyout>
      </div>
    );

    await user.hover(screen.getByTestId('trigger'));
    const opened = await screen.findByRole('group', { name: /assets/i });
    expect(opened).toHaveAccessibleName('Assets');
  });

  it('opens immediately on keyboard focus', async () => {
    render(<Harness />);
    trigger().focus();
    await waitFor(() => expect(panel()).toBeInTheDocument());
  });

  it('does not open at all on the expanded rail', async () => {
    const user = userEvent.setup();
    render(<Harness enabled={false} />);
    await user.hover(trigger());
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(panel()).not.toBeInTheDocument();
  });

  it('wires aria-controls to the panel it opens', async () => {
    render(<Harness />);
    trigger().focus();
    await waitFor(() => expect(panel()).toBeInTheDocument());

    expect(trigger()).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger().getAttribute('aria-controls')).toBe(panel()?.getAttribute('id'));
  });
});

describe('SidebarFlyout persistence', () => {
  /*
   * The defining requirement, and the one most likely to be "fixed" later by
   * someone assuming a hover menu should close on leave. It must not.
   */
  it('stays open when the cursor leaves the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    await user.unhover(trigger());
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(panel()).toBeInTheDocument();
  });

  it('stays open when the cursor moves somewhere unrelated', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    await user.hover(screen.getByTestId('outside'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(panel()).toBeInTheDocument();
  });
});

describe('SidebarFlyout dismissal', () => {
  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    await user.click(screen.getByTestId('outside'));
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    trigger().focus();
    await waitFor(() => expect(panel()).toBeInTheDocument());

    await user.keyboard('{Escape}');
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger());
  });

  it('closes when a link inside is chosen', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(<Harness onPick={onPick as unknown as () => void} />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    await user.click(screen.getByRole('link', { name: 'Screenshots' }));
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });

  it('closes when the rail expands underneath it', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness enabled />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    rerender(<Harness enabled={false} />);
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });

  it('closes on scroll, since the anchor has moved', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await waitFor(() => expect(panel()).toBeInTheDocument());

    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });

  it('closes rather than trapping focus when tabbing past the last link', async () => {
    render(<Harness />);
    trigger().focus();
    await waitFor(() => expect(panel()).toBeInTheDocument());

    // Move focus out of the panel entirely; jsdom fires the real focusout that
    // React's onBlur is built on.
    screen.getByRole('link', { name: 'Screenshots' }).focus();
    screen.getByTestId('outside').focus();

    await waitFor(() => expect(panel()).not.toBeInTheDocument());
  });
});

describe('SidebarFlyout hover intent', () => {
  it('does not open if the cursor only passes over', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.hover(trigger());
    await user.unhover(trigger());
    await new Promise((resolve) => setTimeout(resolve, 260));

    // The pending timer is cancelled on leave; only an open panel persists.
    expect(panel()).not.toBeInTheDocument();
  });
});
