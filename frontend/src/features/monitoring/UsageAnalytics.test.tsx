import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UsageAnalytics from './UsageAnalytics';

const data = {
  organization_summary: {
    tracked_duration: 14400,
    working_duration: 12600,
    idle_duration: 1800,
    break_seconds: 0,
    productive_duration: 7200,
    neutral_duration: 2400,
    context_dependent_duration: 600,
    unproductive_duration: 1800,
    productive_share: 60,
    unproductive_share: 15,
    neutral_share: 20,
    context_dependent_share: 5,
  },
  activity_breakdown: [
    { type: 'app', count: 40, total_duration: 7200 },
    { type: 'url', count: 22, total_duration: 3600 },
    { type: 'idle', count: 4, total_duration: 1800 },
  ],
  organization_tools: {
    productive: [{ label: 'Visual Studio Code', type: 'software', classification: 'productive', total_duration: 5400, total_events: 90 }],
    unproductive: [{ label: 'instagram.com', type: 'website', classification: 'unproductive', total_duration: 900, total_events: 12 }],
    neutral: [{ label: 'Slack', type: 'software', classification: 'neutral', total_duration: 1500, total_events: 30 }],
    context_dependent: [{ label: 'youtube.com', type: 'website', classification: 'context_dependent', total_duration: 600, total_events: 8 }],
  },
  employee_rankings: {
    by_productive_duration: [
      {
        user: { id: 7, name: 'Zara Khan' },
        productive_duration: 7200,
        neutral_duration: 2400,
        context_dependent_duration: 600,
        unproductive_duration: 1800,
        total_duration: 14400,
      },
    ],
  },
  team_rankings: { by_efficiency: [{ group: { id: 1, name: 'Engineering' }, efficiency_score: 76 }] },
};

const baseProps = {
  data,
  hasSelectedEmployee: false,
  scopeLabel: 'All employees',
  isFetching: false,
  canReclassify: true,
  onReclassify: vi.fn().mockResolvedValue(true),
};

describe('UsageAnalytics', () => {
  it('renders the four-class share and the app/web/idle breakdown', () => {
    render(<UsageAnalytics {...baseProps} />);

    expect(screen.getByText('60.0%')).toBeInTheDocument();
    // The previously hidden neutral bucket is visible.
    expect(screen.getByText('Slack')).toBeInTheDocument();
    // Donut legend names the three activity kinds with their durations
    // ("Websites" also exists as a filter chip, so anchor on the durations).
    expect(screen.getByText('Applications')).toBeInTheDocument();
    expect(screen.getByText('2h 0m')).toBeInTheDocument();
    expect(screen.getByText('0h 30m')).toBeInTheDocument();
  });

  it('merges all classes into one duration-ranked list and filters through chips', () => {
    render(<UsageAnalytics {...baseProps} />);

    // All four tools in one list, ranked: VS Code first.
    const list = screen.getByText('Visual Studio Code').closest('ul')!;
    expect(list).toContainElement(screen.getByText('instagram.com'));
    expect(list).toContainElement(screen.getByText('youtube.com'));

    fireEvent.click(screen.getByRole('button', { name: 'Unproductive' }));
    expect(screen.getByText('instagram.com')).toBeInTheDocument();
    expect(screen.queryByText('Visual Studio Code')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Websites' }));
    expect(screen.getByText('instagram.com')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).not.toBeInTheDocument();
  });

  it('reclassifies a website through the existing classification endpoint shape', async () => {
    const onReclassify = vi.fn().mockResolvedValue(true);
    render(<UsageAnalytics {...baseProps} onReclassify={onReclassify} />);

    const select = screen.getByLabelText('Reclassify youtube.com');
    fireEvent.change(select, { target: { value: 'productive' } });

    await waitFor(() => {
      expect(onReclassify).toHaveBeenCalledWith('domain', 'youtube.com', 'productive');
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('hides the reclassify control for non-admins', () => {
    render(<UsageAnalytics {...baseProps} canReclassify={false} />);
    expect(screen.queryByLabelText(/Reclassify/)).not.toBeInTheDocument();
  });
});
