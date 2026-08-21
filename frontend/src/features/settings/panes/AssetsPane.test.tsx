import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssetsPane from './AssetsPane';
import ProfilePane from './ProfilePane';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { SettingsController } from '../useSettingsController';

/*
 * The personal assets list used to sit at the bottom of the Profile pane,
 * below the timezone picker. It now has a settings tab of its own, and these
 * pin both halves of that move — that Assets renders it, and that Profile no
 * longer does, so it cannot quietly come back and appear in two places.
 */

const mocks = vi.hoisted(() => ({ employeeAssets: vi.fn() }));

vi.mock('@/services/assetsApi', () => ({
  assetsApi: { employeeAssets: mocks.employeeAssets },
}));

// ProfilePane also renders the KYC block, which pulls the auth context and a
// large tree. It has its own coverage; here it is only in the way.
vi.mock('@/components/EmployeeDetailsSection', () => ({
  default: () => <div data-testid="employee-details-section" />,
}));

const controller = {
  user: { id: 7, name: 'Ava', email: 'ava@acme.in', role: 'employee' },
  organization: { id: 1, name: 'Acme' },
  canEditEmail: false,
  profileName: 'Ava',
  setProfileName: vi.fn(),
  profileEmail: 'ava@acme.in',
  setProfileEmail: vi.fn(),
  profileAvatarPreview: '',
  applyAvatarFile: vi.fn(),
  personalDetailsForm: {},
  setPersonalDetailsForm: vi.fn(),
  isLoadingPersonalDetails: false,
  timezone: 'Asia/Kolkata',
  setTimezone: vi.fn(),
  fieldErrors: {},
} as unknown as SettingsController;

describe('AssetsPane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.employeeAssets.mockResolvedValue({ data: { data: [] } });
  });

  it('lists the kit assigned to this person', async () => {
    mocks.employeeAssets.mockResolvedValue({
      data: {
        data: [
          {
            assignment_id: 1,
            asset_tag: 'LAP-014',
            name: 'ThinkPad T14',
            category: 'laptop',
            assigned_date: '2026-03-02',
          },
        ],
      },
    });

    renderWithProviders(<AssetsPane controller={controller} />);

    expect(await screen.findByText('LAP-014')).toBeInTheDocument();
    expect(screen.getByText('ThinkPad T14')).toBeInTheDocument();
  });

  it('says so plainly when nothing is issued', async () => {
    renderWithProviders(<AssetsPane controller={controller} />);

    expect(await screen.findByText(/no assets are currently assigned to you/i)).toBeInTheDocument();
  });

  it('asks for this user’s assets and nobody else’s', async () => {
    renderWithProviders(<AssetsPane controller={controller} />);

    expect(await screen.findByText(/no assets are currently assigned/i)).toBeInTheDocument();
    expect(mocks.employeeAssets).toHaveBeenCalledWith(7);
  });
});

describe('ProfilePane no longer carries the assets list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.employeeAssets.mockResolvedValue({ data: { data: [] } });
  });

  it('does not render it, and does not fetch it', () => {
    renderWithProviders(<ProfilePane controller={controller} />);

    expect(screen.queryByText(/no assets are currently assigned to you/i)).not.toBeInTheDocument();
    // The fetch is the real tell: a stray render would still cost a request on
    // every visit to Profile.
    expect(mocks.employeeAssets).not.toHaveBeenCalled();
  });
});
