import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const sessions = vi.fn();
const revokeSession = vi.fn();
const revokeOtherSessions = vi.fn();
const logout = vi.fn();

vi.mock('@/services/api', () => ({
  authApi: {
    sessions: () => sessions(),
    revokeSession: (...args: unknown[]) => revokeSession(...args),
    revokeOtherSessions: () => revokeOtherSessions(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ logout }),
}));

import SignedInDevicesSection from '../components/SignedInDevicesSection';

import { brandLabel } from '@/config/brand';
function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const renderSection = () =>
  render(
    <Providers>
      <SignedInDevicesSection fallbackDeviceLabel="Chrome on Windows" />
    </Providers>,
  );

const thisPc = {
  id: 1,
  device: 'Chrome on Windows',
  ip: '203.0.113.9',
  signed_in_ip: '203.0.113.9',
  last_used_at: new Date().toISOString(),
  created_at: '2026-08-26T09:00:00+00:00',
  expires_at: '2026-09-02T09:00:00+00:00',
  is_current: true,
};

const otherPc = {
  id: 2,
  device: 'Firefox on macOS',
  ip: '198.51.100.4',
  signed_in_ip: '198.51.100.4',
  last_used_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  created_at: '2026-08-26T08:00:00+00:00',
  expires_at: '2026-09-02T08:00:00+00:00',
  is_current: false,
};

/**
 * What the table actually holds. Every token minted before capture existed has
 * a null user agent and a null address, so the honest label is the same on all
 * of them — which is exactly why a row per token answers nothing.
 */
const manyOtherPcs = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: 100 + index,
    device: `Unknown device ${index + 1}`,
    ip: null,
    signed_in_ip: null,
    last_used_at: new Date(Date.now() - (index + 5) * 60_000).toISOString(),
    created_at: '2026-08-20T08:00:00+00:00',
    expires_at: '2026-08-27T08:00:00+00:00',
    is_current: false,
  })).reverse();

const listOf = (rows: unknown[], concurrent: boolean) => ({
  data: rows,
  concurrent_use: concurrent,
  active_device_count: concurrent ? rows.length : 1,
  concurrent_window_minutes: 15,
});

beforeEach(() => {
  sessions.mockReset();
  revokeSession.mockReset();
  revokeOtherSessions.mockReset();
  logout.mockReset();
  sessions.mockResolvedValue(listOf([thisPc], false));
});

/**
 * This block exists to answer one question — "is anybody else on my account?"
 * — that the old client-side card structurally could not: a browser reading
 * its own user agent can never mention a second machine.
 */
describe('where you are signed in', () => {
  it('lists every live session, with the address and when it was last active', async () => {
    sessions.mockResolvedValue(listOf([thisPc, otherPc], true));

    renderSection();

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('Firefox on macOS')).toBeInTheDocument();

    // The address is shown as itself. Resolving it to a city would mean
    // posting our users' IPs to a third party on every settings page view.
    expect(screen.getByText(/IP 198\.51\.100\.4 · 4 minutes ago/)).toBeInTheDocument();
  });

  it('marks the device you are reading this on', async () => {
    sessions.mockResolvedValue(listOf([thisPc, otherPc], true));

    renderSection();

    // Exactly one, and it is the row the server flagged — not the one whose
    // user agent happens to match this browser.
    const chips = await screen.findAllByText('This device');
    expect(chips).toHaveLength(1);
  });

  it('signs out another device through the endpoint, and drops the row', async () => {
    sessions
      .mockResolvedValueOnce(listOf([thisPc, otherPc], true))
      .mockResolvedValue(listOf([thisPc], false));
    revokeSession.mockResolvedValue({ was_current_session: false });

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /sign out firefox on macos/i }));

    // Not window.confirm: a destructive action gets a dialog that can be read,
    // themed and cancelled.
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(new RegExp(`will be signed out the next time it contacts ${brandLabel}`, 'i'))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /^sign out$/i }));

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith(2));
    await waitFor(() => expect(screen.queryByText('Firefox on macOS')).not.toBeInTheDocument());

    // The device you clicked from stays signed in. Revoking one session while
    // the others survive is the entire point.
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
  });

  it('signs this device out the way it always has, rather than deleting its own row', async () => {
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /sign out chrome on windows/i }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^sign out$/i }));

    // logout() flushes the desktop tracker and stops a running timer before it
    // drops the token; deleting the row underneath that loses whatever had not
    // been sent yet.
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(revokeSession).not.toHaveBeenCalled();
  });

  it('names how many devices are in use, only when the server says more than one is', async () => {
    sessions.mockResolvedValue(listOf([thisPc, otherPc], true));

    renderSection();

    const banner = await screen.findByTestId('concurrent-devices-banner');
    expect(banner).toHaveTextContent('2 devices have used this account in the last 15 minutes.');
    // Calm, not an alarm — two devices is a laptop and a phone.
    expect(banner).toHaveTextContent(/that is normal if one of them is your phone/i);
  });

  it('says nothing about concurrent use when only one device is active', async () => {
    sessions.mockResolvedValue(listOf([thisPc, otherPc], false));

    renderSection();

    expect(await screen.findByText('Firefox on macOS')).toBeInTheDocument();
    expect(screen.queryByTestId('concurrent-devices-banner')).not.toBeInTheDocument();
  });

  it('says it could not check, rather than showing an empty list', async () => {
    sessions.mockRejectedValue(new Error('network'));

    renderSection();

    /*
     * "No other devices" and "we could not check" are opposite answers to the
     * question being asked. Rendering the second as the first is the only
     * outcome worse than showing nothing.
     */
    expect(await screen.findByText(/could not read your other devices/i)).toBeInTheDocument();
    expect(screen.getByText(/does not mean there are none/i)).toBeInTheDocument();

    // And it falls back to what this block showed before the endpoint existed.
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
  });

  /**
   * The failure this list shipped with: a production account holds 163 live
   * tokens (a seven-day TTL, one token per sign-in, and only logout deletes
   * one), so the card rendered 163 rows and 163 Sign out buttons. "Is anyone
   * else on my account" is not answerable from a wall.
   */
  it('collapses a long list instead of rendering a row per token', async () => {
    sessions.mockResolvedValue(listOf([thisPc, ...manyOtherPcs(20)], false));

    renderSection();

    await screen.findByText('Chrome on Windows');

    // Five rows, this device among them, and the rest behind one control.
    expect(screen.getAllByRole('button', { name: /^sign out (?!everywhere)/i })).toHaveLength(5);
    expect(screen.getByText('Unknown device 19')).toBeInTheDocument();
    expect(screen.queryByText('Unknown device 1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show 16 more devices/i }));

    expect(screen.getByText('Unknown device 1')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^sign out (?!everywhere)/i })).toHaveLength(21);
  });

  /** Whatever the order, the row you are standing in is never behind the fold. */
  it('keeps this device visible even when it is not the most recent row', async () => {
    sessions.mockResolvedValue(listOf([...manyOtherPcs(20), thisPc], false));

    renderSection();

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
  });

  /**
   * The one action that scales, and the one somebody wants at the moment they
   * think their password has leaked. Without it, 162 unrecognised sessions
   * means 162 confirmations, which nobody finishes.
   */
  it('signs out every other device in one act, and keeps this one', async () => {
    sessions
      .mockResolvedValueOnce(listOf([thisPc, otherPc], true))
      .mockResolvedValue(listOf([thisPc], false));
    revokeOtherSessions.mockResolvedValue({ revoked_count: 1 });

    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /sign out everywhere else/i }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/this device stays signed in/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /sign out the others/i }));

    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Firefox on macOS')).not.toBeInTheDocument());

    // Not logout(): the whole promise of the button is that this browser
    // survives it.
    expect(logout).not.toHaveBeenCalled();
    expect(screen.getByText('Chrome on Windows')).toBeInTheDocument();
  });

  /** What the server could not fit is stated, never quietly dropped. */
  it('says how many sessions exist when the server has capped the list', async () => {
    sessions.mockResolvedValue({
      ...listOf([thisPc, ...manyOtherPcs(49)], false),
      total_count: 163,
      listed_count: 50,
    });

    renderSection();

    expect(await screen.findByText(/50 of 163 sessions shown/i)).toBeInTheDocument();
  });

  /**
   * "4 minutes ago" is computed at render. Frozen, it is the worst kind of
   * stale on the one screen whose job is to say what is in use right now.
   */
  it('keeps the relative times moving while the pane is open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    sessions.mockResolvedValue(listOf([thisPc], false));

    renderSection();

    expect(await screen.findByText(/Active just now/)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(screen.getByText(/5 minutes ago/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});
