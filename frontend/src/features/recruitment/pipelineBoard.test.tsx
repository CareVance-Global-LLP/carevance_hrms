import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const stages = vi.fn();
const applications = vi.fn();
const moveApplication = vi.fn();

vi.mock('@/services/api', () => ({
  recruitmentApi: {
    stages: () => stages(),
    applications: (...args: unknown[]) => applications(...args),
    moveApplication: (...args: unknown[]) => moveApplication(...args),
    applicationEvents: vi.fn(),
    decideApplication: vi.fn(),
  },
}));

import PipelineBoard from './PipelineBoard';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const STAGES = [
  { id: 1, name: 'Applied', slug: 'applied', position: 0, kind: 'screening', is_terminal: false, is_active: true },
  { id: 2, name: 'Screening', slug: 'screening', position: 1, kind: 'screening', is_terminal: false, is_active: true },
  { id: 3, name: 'Interview', slug: 'interview', position: 2, kind: 'interview', is_terminal: false, is_active: true },
  { id: 9, name: 'Retired', slug: 'retired', position: 9, kind: 'screening', is_terminal: false, is_active: false },
];

const APPLICATION = {
  id: 11,
  job_opening_id: 5,
  candidate_id: 7,
  hiring_stage_id: 1,
  status: 'active',
  candidate: { id: 7, first_name: 'Priya', last_name: 'Nair', email: 'priya@example.test' },
  stage: { id: 1, name: 'Applied', kind: 'screening', position: 0 },
};

beforeEach(() => {
  stages.mockReset();
  applications.mockReset();
  moveApplication.mockReset();

  stages.mockResolvedValue({ data: { data: STAGES } });
  applications.mockResolvedValue({ data: { data: [APPLICATION] } });
  moveApplication.mockResolvedValue({ data: { data: APPLICATION } });
});

/**
 * The board.
 *
 * Two properties are worth holding down: every stage keeps its column even when
 * empty, because the gap is the thing a hiring manager needs to see; and a
 * refused move is shown rather than swallowed, because a card silently
 * springing back is the worst possible feedback.
 */
describe('pipeline board', () => {
  it('gives every active stage a column, including the empty ones', async () => {
    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    // Empty columns are the point. A board that hides its gaps cannot show
    // where a pipeline has dried up.
    expect(await screen.findByRole('region', { name: /Applied, 1 candidates/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Screening, 0 candidates/ })).toBeInTheDocument();
    expect(screen.getAllByText('Nobody here')).toHaveLength(2);
  });

  it('does not offer a retired stage', async () => {
    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    await screen.findByText('Priya Nair');

    // The server refuses a move to an inactive stage, so offering one is an
    // error the UI walks the user into.
    expect(screen.queryByRole('region', { name: /Retired/ })).not.toBeInTheDocument();
  });

  it('moves a candidate from the keyboard, not only by dragging', async () => {
    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    const select = await screen.findByLabelText(/Move Priya to another stage/i);
    fireEvent.change(select, { target: { value: '3' } });

    // A recruiter lives in this screen all day. Mouse-only would exclude
    // keyboard users and anybody working fast.
    await waitFor(() => expect(moveApplication).toHaveBeenCalledWith(11, 3));
  });

  it('shows a refused move rather than letting the card spring back silently', async () => {
    moveApplication.mockRejectedValue({
      response: { data: { message: 'That application is already hired. Reopen it before moving it.' } },
    });

    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    const select = await screen.findByLabelText(/Move Priya to another stage/i);
    fireEvent.change(select, { target: { value: '2' } });

    expect(await screen.findByText(/already hired/i)).toBeInTheDocument();
  });

  it('separates an empty stage from nobody having applied', async () => {
    applications.mockResolvedValue({ data: { data: [] } });

    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    // Different facts. "This stage is empty" and "this role has no candidates
    // at all" lead to different next actions.
    expect(await screen.findByText(/No live candidates for this role yet/i)).toBeInTheDocument();
  });

  it('asks the server only for live candidacies', async () => {
    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    await screen.findByText('Priya Nair');

    // Rejected and hired people would otherwise sit in the columns forever and
    // make every pipeline look permanently full.
    expect(applications).toHaveBeenCalledWith({ job_opening_id: 5, status: 'active' });
  });

  it('counts the candidates in each column', async () => {
    render(
      <Providers>
        <PipelineBoard jobOpeningId={5} />
      </Providers>,
    );

    const applied = await screen.findByRole('region', { name: /Applied/ });
    expect(within(applied).getByText('1')).toBeInTheDocument();
  });
});
