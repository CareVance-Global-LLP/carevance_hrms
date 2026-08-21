import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const days = vi.fn();
const publish = vi.fn();

vi.mock('@/services/api', () => ({
  rosterApi: {
    days: (...args: unknown[]) => days(...args),
    publish: (...args: unknown[]) => publish(...args),
    coverage: vi.fn(),
    rotations: vi.fn(),
    generate: vi.fn(),
    saveRotation: vi.fn(),
    assignRotation: vi.fn(),
    setDay: vi.fn(),
    swaps: vi.fn(),
    requestSwap: vi.fn(),
    respondToSwap: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, name: 'Kajal', role: 'manager', organization_id: 1 } }),
}));

// The rota page composes two panels that fetch on their own. They have their
// own tests; here they are stubbed so a grid assertion cannot fail for
// something a sibling panel did.
vi.mock('@/features/roster/RotationEditor', () => ({ default: () => null }));
vi.mock('@/features/roster/SwapPanel', () => ({ default: () => null }));

import RosterPage from './RosterPage';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A date inside the page's default two-week window. */
const TODAY = new Date().toISOString().slice(0, 10);

const day = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user_id: 7,
  name: 'Kajal',
  date: TODAY,
  shift_id: 3,
  shift: 'Early',
  is_rest_day: false,
  status: 'published',
  source: 'generated',
  note: null,
  ...over,
});

beforeEach(() => {
  days.mockReset();
  publish.mockReset();
  publish.mockResolvedValue({ data: { published: 0 } });
});

/**
 * The rota grid.
 *
 * The property worth holding: a rostered rest day and an unrostered day must
 * not both render as whitespace. They are different facts, and collapsing them
 * is why people ring their manager to ask whether they are working.
 */
describe('roster page', () => {
  it('shows a rostered rest day rather than leaving the cell blank', async () => {
    days.mockResolvedValue({
      data: { from: TODAY, to: TODAY, can_manage: true, data: [day({ shift_id: null, shift: null, is_rest_day: true })] },
    });

    render(
      <Providers>
        <RosterPage />
      </Providers>,
    );

    // "You are off" and "nobody scheduled you" are different things to be told.
    expect(await screen.findByTitle('Off')).toBeInTheDocument();
  });

  it('marks a draft day as not yet visible to the team', async () => {
    days.mockResolvedValue({
      data: { from: TODAY, to: TODAY, can_manage: true, data: [day({ status: 'draft' })] },
    });

    render(
      <Providers>
        <RosterPage />
      </Providers>,
    );

    // A roster that looks identical before and after publishing is one
    // somebody assumes they have already sent out.
    expect(await screen.findByTitle(/not published yet/i)).toBeInTheDocument();
    expect(screen.getByText(/still draft and not visible to the team/i)).toBeInTheDocument();
  });

  it('says so when a publish moved nothing', async () => {
    days.mockResolvedValue({
      data: { from: TODAY, to: TODAY, can_manage: true, data: [day({ status: 'draft' })] },
    });

    render(
      <Providers>
        <RosterPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /publish/i }));

    // A publish that affected nothing looks identical to one that worked
    // unless it says so.
    expect(await screen.findByText(/nothing to publish/i)).toBeInTheDocument();
  });

  it('does not offer publishing to somebody who cannot manage', async () => {
    days.mockResolvedValue({
      data: { from: TODAY, to: TODAY, can_manage: false, data: [day()] },
    });

    render(
      <Providers>
        <RosterPage />
      </Providers>,
    );

    await screen.findByText('Kajal');

    // can_manage comes from the server, which already narrows what it returns
    // by role. A second guess in the browser is how the two drift apart.
    expect(screen.queryByRole('button', { name: /publish/i })).not.toBeInTheDocument();
  });

  it('distinguishes an empty rota from an unpublished one', async () => {
    days.mockResolvedValue({
      data: { from: TODAY, to: TODAY, can_manage: false, data: [] },
    });

    render(
      <Providers>
        <RosterPage />
      </Providers>,
    );

    // An employee seeing nothing has a different problem from a manager seeing
    // nothing, and the message says which.
    expect(await screen.findByText(/nothing published for you/i)).toBeInTheDocument();
  });
});
