import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const listDevices = vi.fn();
const listConnections = vi.fn();

vi.mock('@/services/api', () => ({
  biometricDeviceApi: {
    list: (...args: unknown[]) => listDevices(...args),
    create: vi.fn(),
    update: vi.fn(),
    claim: vi.fn(),
  },
  samlConnectionApi: {
    list: (...args: unknown[]) => listConnections(...args),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
  userApi: {
    getAll: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

import BiometricDevicesPane from './BiometricDevicesPane';
import SingleSignOnPane from './SingleSignOnPane';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/**
 * Both of these integrations fail silently, and both panes exist mainly to make
 * the silence audible. These tests hold that: a quiet device and an expired
 * certificate must be visible as problems, not as ordinary rows.
 */
describe('biometric devices pane', () => {
  it('calls out a device that has stopped reporting', async () => {
    listDevices.mockResolvedValue({
      data: {
        data: [
          {
            id: 1,
            organization_id: 1,
            serial_number: 'ESSL1',
            name: 'Reception',
            is_active: true,
            is_stale: true,
            last_seen_at: '2026-08-19T09:00:00Z',
            punches_received: 40,
          },
        ],
        unmapped: [],
        endpoint: 'https://app.carevance.test/api/iclock',
      },
    });

    render(
      <Providers>
        <BiometricDevicesPane />
      </Providers>,
    );

    // "Not reporting" rather than a timestamp an admin has to interpret: no
    // attendance from a device is indistinguishable from an empty office.
    expect(await screen.findByText(/not reporting/i)).toBeInTheDocument();
    expect(screen.getByText(/no attendance is arriving/i)).toBeInTheDocument();
  });

  it('names each unclaimed device id and how much history is waiting on it', async () => {
    listDevices.mockResolvedValue({
      data: {
        data: [],
        unmapped: [
          { device_user_id: '77', punch_count: 12, first_seen: '2026-08-01T04:00:00Z', last_seen: '2026-08-20T04:00:00Z' },
        ],
        endpoint: 'https://app.carevance.test/api/iclock',
      },
    });

    render(
      <Providers>
        <BiometricDevicesPane />
      </Providers>,
    );

    // Per id, because "12 unmapped punches" is not something an admin can act
    // on and "ID 77 has 12" tells them who to go and ask.
    expect(await screen.findByText('ID 77')).toBeInTheDocument();
    expect(screen.getByText(/12 punches/)).toBeInTheDocument();
  });
});

describe('single sign-on pane', () => {
  const serviceProvider = {
    entity_id: 'https://app.carevance.test/saml/metadata',
    acs_url: 'https://app.carevance.test/api/auth/saml/callback',
    metadata_url: 'https://app.carevance.test/api/auth/saml/metadata',
  };

  const connection = {
    id: 1,
    organization_id: 1,
    name: 'Entra',
    idp_entity_id: 'https://sts.windows.net/abc/',
    idp_sso_url: 'https://login.microsoftonline.com/abc/saml2',
    provision_users: false,
    is_active: true,
  };

  it('says how long the signing certificate has left', async () => {
    listConnections.mockResolvedValue({
      data: {
        data: [
          {
            ...connection,
            certificate: {
              subject: 'idp.example.test',
              expires_at: '2027-01-01T00:00:00Z',
              days_remaining: 120,
              fingerprint: 'ABC123',
            },
          },
        ],
        service_provider: serviceProvider,
      },
    });

    render(
      <Providers>
        <SingleSignOnPane />
      </Providers>,
    );

    expect(await screen.findByText(/expires in 120 days/i)).toBeInTheDocument();
  });

  it('reports an expired certificate as sign-ins failing, not as a date', async () => {
    listConnections.mockResolvedValue({
      data: {
        data: [
          {
            ...connection,
            certificate: {
              subject: 'idp.example.test',
              expires_at: '2026-07-12T00:00:00Z',
              days_remaining: -40,
              fingerprint: 'ABC123',
            },
          },
        ],
        service_provider: serviceProvider,
      },
    });

    render(
      <Providers>
        <SingleSignOnPane />
      </Providers>,
    );

    // The whole organization is locked out at this point, including whoever
    // would fix it, so it is stated as the outage it is.
    expect(await screen.findByText(/expired 40 days ago/i)).toBeInTheDocument();
    expect(screen.getByText(/sign-ins are failing/i)).toBeInTheDocument();
  });

  it('treats an unreadable certificate as broken rather than absent', async () => {
    listConnections.mockResolvedValue({
      data: {
        data: [{ ...connection, certificate: null }],
        service_provider: serviceProvider,
      },
    });

    render(
      <Providers>
        <SingleSignOnPane />
      </Providers>,
    );

    expect(await screen.findByText(/cannot be read/i)).toBeInTheDocument();
  });

  it('shows the identifier and reply URL the identity provider needs', async () => {
    listConnections.mockResolvedValue({
      data: { data: [], service_provider: serviceProvider },
    });

    render(
      <Providers>
        <SingleSignOnPane />
      </Providers>,
    );

    // Both come from the server: the audience check compares the entity ID
    // byte-for-byte, so a value built in the browser would differ behind a
    // proxy and every assertion would be rejected.
    expect(await screen.findByText(serviceProvider.entity_id)).toBeInTheDocument();
    expect(screen.getByText(serviceProvider.acs_url)).toBeInTheDocument();
  });
});
