import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const interviews = vi.fn();
const interviewSummary = vi.fn();
const offers = vi.fn();

vi.mock('@/services/api', () => ({
  recruitmentApi: {
    interviews: (...a: unknown[]) => interviews(...a),
    interviewSummary: (...a: unknown[]) => interviewSummary(...a),
    scheduleInterview: vi.fn(),
    submitFeedback: vi.fn(),
    offers: (...a: unknown[]) => offers(...a),
    draftOffer: vi.fn(),
    submitOffer: vi.fn(),
    decideOffer: vi.fn(),
    sendOffer: vi.fn(),
    withdrawOffer: vi.fn(),
    issueSigningLink: vi.fn(),
  },
  userApi: { getAll: vi.fn().mockResolvedValue({ data: [] }) },
}));

import InterviewPanel from './InterviewPanel';
import OfferPanel from './OfferPanel';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const INTERVIEW = {
  id: 5,
  job_application_id: 11,
  title: 'Systems design',
  mode: 'video',
  scheduled_at: '2026-09-01T10:00:00Z',
  duration_minutes: 60,
  status: 'completed',
};

beforeEach(() => {
  interviews.mockReset();
  interviewSummary.mockReset();
  offers.mockReset();
  interviews.mockResolvedValue({ data: { data: [INTERVIEW] } });
  offers.mockResolvedValue({ data: { data: [] } });
});

/**
 * The two panels exist to surface facts a score or a status would hide: a
 * divided panel, and who was asked to approve an offer but has not answered.
 */
describe('interview panel', () => {
  it('calls out a divided panel in words rather than a score', async () => {
    interviewSummary.mockResolvedValue({
      data: {
        data: {
          panel: { invited: 3, submitted: 3, outstanding: 0 },
          verdicts: { strong_yes: 1, yes: 1, no: 0, strong_no: 1 },
          is_split: true,
          feedback: [
            { interviewer: 'Alice', verdict: 'strong_yes', rating: 5, notes: null, submitted_at: null },
            { interviewer: 'Bob', verdict: 'yes', rating: 4, notes: null, submitted_at: null },
            { interviewer: 'Carol', verdict: 'strong_no', rating: 1, notes: null, submitted_at: null },
          ],
        },
      },
    });

    render(
      <Providers>
        <InterviewPanel applicationId={11} />
      </Providers>,
    );

    // Two-to-one and a unanimously lukewarm panel produce the same mean, and
    // they call for completely different conversations.
    (await screen.findByRole('button', { name: /feedback/i })).click();
    expect(await screen.findByText(/panel is divided/i)).toBeInTheDocument();
  });

  it('says how much of the panel has not answered', async () => {
    interviewSummary.mockResolvedValue({
      data: {
        data: {
          panel: { invited: 3, submitted: 1, outstanding: 2 },
          verdicts: { strong_yes: 0, yes: 1, no: 0, strong_no: 0 },
          is_split: false,
          feedback: [{ interviewer: 'Alice', verdict: 'yes', rating: 4, notes: null, submitted_at: null }],
        },
      },
    });

    render(
      <Providers>
        <InterviewPanel applicationId={11} />
      </Providers>,
    );

    (await screen.findByRole('button', { name: /feedback/i })).click();

    // The question a recruiter chases all day, and one a list of submitted
    // feedback alone cannot answer.
    expect(await screen.findByText(/1 of 3 have given feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/2 outstanding/i)).toBeInTheDocument();
  });
});

describe('offer panel', () => {
  it('lists approvers who have not answered rather than omitting them', async () => {
    offers.mockResolvedValue({
      data: {
        data: [{
          id: 3,
          job_application_id: 11,
          designation: 'Backend Engineer',
          annual_ctc: '1800000.00',
          status: 'pending_approval',
          approvals: [
            { id: 1, approver_id: 2, position: 0, status: 'approved', approver: { id: 2, name: 'Head of Eng' } },
            { id: 2, approver_id: 3, position: 1, status: 'pending', approver: { id: 3, name: 'Finance' } },
          ],
        }],
      },
    });

    render(
      <Providers>
        <OfferPanel applicationId={11} />
      </Providers>,
    );

    // "Nobody ever asked finance" is exactly what an audit looks for, so a
    // pending approver is shown as pending rather than left out.
    expect(await screen.findByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('shows offers for this candidacy only', async () => {
    offers.mockResolvedValue({
      data: {
        data: [
          { id: 3, job_application_id: 11, designation: 'Backend Engineer', annual_ctc: '1800000.00', status: 'draft' },
          { id: 4, job_application_id: 99, designation: 'Somebody Else', annual_ctc: '900000.00', status: 'draft' },
        ],
      },
    });

    render(
      <Providers>
        <OfferPanel applicationId={11} />
      </Providers>,
    );

    // The list endpoint is organization-wide; showing another candidate's
    // salary on this drawer would be a genuine disclosure.
    expect(await screen.findByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.queryByText('Somebody Else')).not.toBeInTheDocument();
  });
});
