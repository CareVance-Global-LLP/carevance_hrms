import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Assets from '@/pages/Assets';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  remove: vi.fn().mockResolvedValue({ data: { message: 'ok' } }),
  returnAsset: vi.fn().mockResolvedValue({ data: { message: 'ok' } }),
}));

vi.mock('@/services/assetsApi', () => ({
  assetsApi: {
    list: mocks.list,
    get: mocks.get,
    remove: mocks.remove,
    return: mocks.returnAsset,
    create: vi.fn(),
    update: vi.fn(),
    assign: vi.fn(),
    employeeAssets: vi.fn(),
  },
  default: {},
}));

// The form and assign modals own their own data fetching; they are not the
// subject here.
vi.mock('@/components/assets/AssetFormModal', () => ({ default: () => null }));
vi.mock('@/components/assets/AssignAssetModal', () => ({ default: () => null }));

const YEAR_AGO = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const MONTHS_AGO = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('Assets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({
      data: {
        data: [
          {
            id: 1,
            asset_tag: 'CV-LT-041',
            name: 'MacBook Pro 14',
            category: 'laptop',
            serial_number: 'C02XK1ZWMD6T',
            status: 'assigned',
            purchase_date: YEAR_AGO,
            created_at: YEAR_AGO,
            assigned_to: {
              assignment_id: 9,
              user_id: 2,
              name: 'Priya Sharma',
              email: 'priya@example.com',
              assigned_date: YEAR_AGO,
            },
          },
          {
            id: 2,
            asset_tag: 'CV-MN-012',
            name: 'Dell U2723QE',
            category: 'monitor',
            serial_number: null,
            status: 'available',
            purchase_date: MONTHS_AGO,
            created_at: MONTHS_AGO,
            assigned_to: null,
          },
        ],
        // Server-provided, across the whole organization — the page used to
        // derive these from the rows it had already filtered.
        categories: ['laptop', 'monitor', 'phone'],
        meta: { current_page: 1, per_page: 25, total: 2, last_page: 1 },
      },
    });

    mocks.get.mockResolvedValue({
      data: {
        data: {
          id: 1,
          asset_tag: 'CV-LT-041',
          name: 'MacBook Pro 14',
          category: 'laptop',
          serial_number: 'C02XK1ZWMD6T',
          status: 'assigned',
          purchase_date: YEAR_AGO,
          created_at: YEAR_AGO,
          assigned_to: null,
          history: [
            {
              id: 9,
              user: { id: 2, name: 'Priya Sharma', email: 'priya@example.com' },
              assigned_by: { id: 1, name: 'Ritu Nair' },
              assigned_date: YEAR_AGO,
              returned_date: null,
              is_active: true,
            },
            {
              id: 4,
              user: { id: 3, name: 'Arjun Kulkarni', email: 'arjun@example.com' },
              assigned_by: { id: 1, name: 'Ritu Nair' },
              assigned_date: '2024-05-20',
              returned_date: '2025-01-17',
              is_active: false,
            },
          ],
        },
      },
    });
  });

  it('shows the chain of custody that was previously unreachable', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Assets />, { route: '/assets' });

    await user.click(await screen.findByRole('button', { name: 'CV-LT-041' }));

    const drawer = await screen.findByRole('dialog', { name: 'MacBook Pro 14' });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith(1));

    expect(await within(drawer).findByText('Priya Sharma')).toBeInTheDocument();
    expect(within(drawer).getByText('Arjun Kulkarni')).toBeInTheDocument();
    // Who authorised each move is part of the record and was never shown.
    expect(within(drawer).getAllByText(/Assigned by Ritu Nair/)).toHaveLength(2);
  });

  it('offers every organization category, not just those in the filtered rows', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Assets />, { route: '/assets' });

    await screen.findByRole('button', { name: 'CV-LT-041' });
    await user.click(screen.getByRole('button', { name: 'Filter by category' }));

    // "phone" appears in no row on screen but is still selectable — picking a
    // category used to leave that category as the only remaining option.
    expect(await screen.findByRole('option', { name: 'phone' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'laptop' })).toBeInTheDocument();
  });

  it('renders how long each asset has been held and in service', async () => {
    renderWithProviders(<Assets />, { route: '/assets' });

    await screen.findByRole('button', { name: 'CV-LT-041' });

    // Purchase date has been collected by the form since the beginning and
    // displayed nowhere. The laptop has been held over a year (so it is also
    // flagged), the monitor has been in service a couple of months.
    expect(screen.getAllByText(/^1y\b/).length).toBeGreaterThan(0);
    expect(screen.getByText(/^\dm$/)).toBeInTheDocument();
  });

  it('confirms archiving in an in-app dialog rather than window.confirm', async () => {
    const user = userEvent.setup();
    const nativeConfirm = vi.fn(() => true);
    window.confirm = nativeConfirm;

    renderWithProviders(<Assets />, { route: '/assets' });

    await screen.findByRole('button', { name: 'CV-LT-041' });
    await user.click(screen.getByRole('button', { name: 'Archive MacBook Pro 14' }));

    expect(await screen.findByText('Archive this asset?')).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Archive asset' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith(1));
  });

  it('debounces search so typing does not fire a request per keystroke', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Assets />, { route: '/assets' });

    await screen.findByRole('button', { name: 'CV-LT-041' });
    const callsBefore = mocks.list.mock.calls.length;

    await user.type(screen.getByLabelText('Search assets'), 'macbook');

    // Seven characters used to mean seven requests.
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'macbook' }))
    );
    expect(mocks.list.mock.calls.length - callsBefore).toBeLessThan(4);
  });

  it('sorts by how long an asset has been held', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Assets />, { route: '/assets' });

    await screen.findByRole('button', { name: 'CV-LT-041' });
    await user.click(screen.getByRole('button', { name: /Held for/ }));

    const header = screen.getByRole('columnheader', { name: /Held for/ });
    expect(header).toHaveAttribute('aria-sort');
  });
});
