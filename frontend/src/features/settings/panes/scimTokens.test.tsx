import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const list = vi.fn();
const create = vi.fn();

vi.mock('@/services/api', () => ({
  scimTokenApi: {
    list: () => list(),
    create: (...a: unknown[]) => create(...a),
    revoke: vi.fn(),
  },
}));

import ScimTokensSection from './ScimTokensSection';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  list.mockResolvedValue({
    data: { data: [], endpoint: 'https://app.carevance.test/api/scim/v2' },
  });
});

/**
 * A token here creates and deactivates users across the whole workspace. The
 * screen's job is to make that consequence, and the one-time nature of the
 * value, impossible to miss.
 */
describe('scim tokens', () => {
  it('warns what the token can do before it is created', async () => {
    render(
      <Providers>
        <ScimTokensSection />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /create a token/i }));

    // Stated before the button, not after — this is a higher privilege than
    // most administrators exercise by hand.
    expect(
      await screen.findByText(/can create and deactivate anybody in this workspace/i),
    ).toBeInTheDocument();
  });

  it('says the value cannot be shown again, at the moment it is shown', async () => {
    create.mockResolvedValue({
      data: { data: { id: 1, name: 'Entra' }, token: 'scim_abc123', message: 'Copy this now.' },
    });

    render(
      <Providers>
        <ScimTokensSection />
      </Providers>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /create a token/i }));
    fireEvent.change(await screen.findByLabelText(/what is it for/i), { target: { value: 'Entra' } });
    fireEvent.click(screen.getByRole('button', { name: /^create token$/i }));

    // Stored hashed, so nobody — including whoever pressed the button — can
    // retrieve it afterwards.
    expect(await screen.findByText(/cannot be shown again/i)).toBeInTheDocument();
    expect(screen.getByText('scim_abc123')).toBeInTheDocument();
  });

  it('flags a token that has never been used', async () => {
    list.mockResolvedValue({
      data: {
        data: [{ id: 1, name: 'Entra', token_hint: 'abc123', last_used_at: null, is_live: true, created_at: '2026-08-01' }],
        endpoint: 'https://app.carevance.test/api/scim/v2',
      },
    });

    render(
      <Providers>
        <ScimTokensSection />
      </Providers>,
    );

    /*
     * Almost always a paste error. The symptom otherwise is simply that nobody
     * gets provisioned, which reads as the feature not working at all.
     */
    expect(await screen.findByText(/never used/i)).toBeInTheDocument();
  });

  it('shows the tenant URL the provider needs', async () => {
    render(
      <Providers>
        <ScimTokensSection />
      </Providers>,
    );

    expect(await screen.findByText('https://app.carevance.test/api/scim/v2')).toBeInTheDocument();
  });
});
