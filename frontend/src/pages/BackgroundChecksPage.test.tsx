import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const list = vi.fn();
const show = vi.fn();

vi.mock('@/services/api', () => ({
  bgvApi: {
    list: (...a: unknown[]) => list(...a),
    show: (...a: unknown[]) => show(...a),
    recordItem: vi.fn(),
    notify: vi.fn(),
    recordResponse: vi.fn(),
    recordConsent: vi.fn(),
    withdrawConsent: vi.fn(),
    open: vi.fn(),
  },
}));

import BackgroundChecksPage from './BackgroundChecksPage';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CHECK = {
  id: 1,
  candidate_id: 7,
  status: 'completed',
  outcome: 'discrepancy',
  candidate: { id: 7, first_name: 'Priya', last_name: 'Nair', email: 'priya@example.test' },
  items: [
    {
      id: 11,
      background_check_id: 1,
      type: 'education',
      status: 'discrepancy',
      claimed: 'B.Tech 2019',
      verified: 'University records show 2018',
      notes: null,
    },
  ],
  consent: {
    id: 3,
    consented_name: 'Priya Nair',
    scope: ['identity', 'education'],
    consented_at: '2026-08-01T10:00:00Z',
    ip_address: '203.0.113.7',
  },
};

beforeEach(() => {
  list.mockReset();
  show.mockReset();
  list.mockResolvedValue({ data: { data: [CHECK] } });
  show.mockResolvedValue({ data: { data: CHECK, needs_adverse_action_notice: true } });
});

/**
 * The screen exists to put a finding in front of a person, never to decide.
 * These hold the two rules that make it safe: no reject button, and a
 * discrepancy always shows both sides.
 */
describe('background checks', () => {
  it('never offers to reject the candidate', async () => {
    render(
      <Providers>
        <BackgroundChecksPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Priya Nair/ }));
    await screen.findByText('Education');

    /*
     * A name spelled differently on a certificate and a fabricated employer are
     * both discrepancies. The product's job is the comparison, not the verdict.
     */
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('shows both sides of a discrepancy', async () => {
    render(
      <Providers>
        <BackgroundChecksPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Priya Nair/ }));

    // "You said 2019, the university says 2018" is the sentence a discrepancy
    // has to be able to produce.
    expect(await screen.findByText('B.Tech 2019')).toBeInTheDocument();
    expect(screen.getByText('University records show 2018')).toBeInTheDocument();
    expect(screen.getByText(/they said/i)).toBeInTheDocument();
    expect(screen.getByText(/we found/i)).toBeInTheDocument();
  });

  it('says in words that the person has not been told', async () => {
    render(
      <Providers>
        <BackgroundChecksPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Priya Nair/ }));

    // Forgetting is the failure that matters, so it is stated until done.
    expect(await screen.findByText(/has not been told about the finding/i)).toBeInTheDocument();
  });

  it('shows what the consent actually covered', async () => {
    render(
      <Providers>
        <BackgroundChecksPage />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Priya Nair/ }));

    // Verbatim, never widened after the fact.
    expect(await screen.findByText(/Covers: Identity, Education/)).toBeInTheDocument();
  });

  it('separates having no checks from having no consent', async () => {
    list.mockResolvedValue({ data: { data: [] } });

    render(
      <Providers>
        <BackgroundChecksPage />
      </Providers>,
    );

    // Consent comes first, always — the server refuses a check without it, and
    // the empty state says so rather than looking broken.
    expect(await screen.findByText(/starts from a candidate's recorded consent/i)).toBeInTheDocument();
  });
});
