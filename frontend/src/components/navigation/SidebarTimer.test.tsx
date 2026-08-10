import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SidebarTimer, { formatElapsed } from './SidebarTimer';
import { timeEntryApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  timeEntryApi: {
    active: vi.fn(),
    stop: vi.fn(),
  },
}));

const active = timeEntryApi.active as unknown as ReturnType<typeof vi.fn>;
const stop = timeEntryApi.stop as unknown as ReturnType<typeof vi.fn>;

/** A timer started `seconds` ago. */
const running = (seconds: number, extra: Record<string, unknown> = {}) => ({
  data: {
    id: 42,
    start_time: new Date(Date.now() - seconds * 1000).toISOString(),
    end_time: null,
    project: { name: 'Northwind' },
    ...extra,
  },
});

describe('formatElapsed', () => {
  it('pads to hh:mm:ss', () => {
    expect(formatElapsed(0)).toBe('00:00:00');
    expect(formatElapsed(61)).toBe('00:01:01');
    expect(formatElapsed(3 * 3600 + 24 * 60 + 11)).toBe('03:24:11');
  });

  it('keeps counting past 24 hours rather than wrapping', () => {
    expect(formatElapsed(26 * 3600)).toBe('26:00:00');
  });

  it('never renders a negative clock from a skewed clock', () => {
    expect(formatElapsed(-50)).toBe('00:00:00');
  });
});

describe('SidebarTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    active.mockResolvedValue({ data: null });
    stop.mockResolvedValue({});
  });

  afterEach(() => vi.useRealTimers());

  it('renders nothing when no timer is running', async () => {
    const { container } = render(<SidebarTimer collapsed={false} />);
    await waitFor(() => expect(active).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing, and never polls, when disabled for this role', () => {
    const { container } = render(<SidebarTimer collapsed={false} enabled={false} />);
    expect(active).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the elapsed time extrapolated from the entry start', async () => {
    active.mockResolvedValue(running(3 * 3600 + 24 * 60 + 11));
    render(<SidebarTimer collapsed={false} />);
    expect(await screen.findByText(/03:24:1\d/)).toBeInTheDocument();
  });

  it('shows what the timer is running against', async () => {
    active.mockResolvedValue(running(60));
    render(<SidebarTimer collapsed={false} />);
    expect(await screen.findByText(/Northwind/)).toBeInTheDocument();
  });

  it('prefers the task title over the project name', async () => {
    active.mockResolvedValue(running(60, { task: { title: 'Migrate exports' } }));
    render(<SidebarTimer collapsed={false} />);
    expect(await screen.findByText(/Migrate exports/)).toBeInTheDocument();
  });

  it('ignores an entry that has already ended', async () => {
    active.mockResolvedValue({ data: { id: 1, start_time: new Date().toISOString(), end_time: new Date().toISOString() } });
    const { container } = render(<SidebarTimer collapsed={false} />);
    await waitFor(() => expect(active).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores an unparseable start time rather than rendering NaN', async () => {
    active.mockResolvedValue({ data: { id: 1, start_time: 'not a date', end_time: null } });
    const { container } = render(<SidebarTimer collapsed={false} />);
    await waitFor(() => expect(active).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('stops the timer and clears the chip', async () => {
    const user = userEvent.setup();
    active.mockResolvedValue(running(120));
    render(<SidebarTimer collapsed={false} />);

    await user.click(await screen.findByRole('button', { name: /stop timer/i }));
    expect(stop).toHaveBeenCalledWith({ timer_slot: 'primary' });
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop timer/i })).not.toBeInTheDocument());
  });

  it('keeps the chip up if stopping fails, rather than lying about the state', async () => {
    const user = userEvent.setup();
    active.mockResolvedValue(running(120));
    stop.mockRejectedValue(new Error('offline'));
    render(<SidebarTimer collapsed={false} />);

    await user.click(await screen.findByRole('button', { name: /stop timer/i }));
    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /stop timer/i })).toBeInTheDocument();
  });

  it('collapses to a dot but keeps the time available to screen readers', async () => {
    active.mockResolvedValue(running(3 * 3600 + 24 * 60 + 11));
    render(<SidebarTimer collapsed />);

    // No visible clock, no stop button — but the words survive.
    await waitFor(() => expect(screen.queryByRole('button', { name: /stop timer/i })).not.toBeInTheDocument());
    expect(screen.getByText(/Clocked in, 03:24:1\d, Northwind/)).toBeInTheDocument();
  });

  it('survives a failed poll without blanking a running timer', async () => {
    active.mockResolvedValue(running(90));
    render(<SidebarTimer collapsed={false} />);
    const clock = await screen.findByText(/00:01:3\d/);
    expect(clock).toBeInTheDocument();

    active.mockRejectedValue(new Error('network'));
    // The local tick is independent of the network, so the chip stays up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText(/00:01:3\d/)).toBeInTheDocument();
  });

  it('polls once on mount, not once per second', async () => {
    active.mockResolvedValue(running(30));
    render(<SidebarTimer collapsed={false} />);
    await screen.findByText(/00:00:3\d/);
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(active).toHaveBeenCalledTimes(1);
  });
});
