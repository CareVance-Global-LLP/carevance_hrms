import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import InviteLinkPanel from './InviteLinkPanel';

const base = {
  email: 'ravi@acme.in',
  inviteUrl: '',
  onEmailChange: vi.fn(),
  onGenerate: vi.fn(),
  onCopy: vi.fn(),
};

describe('InviteLinkPanel', () => {
  it('shows no grant summary until a link exists', () => {
    render(<InviteLinkPanel {...base} role="manager" expiresInHours={72} />);

    expect(screen.getByText(/generate a link to preview/i)).toBeInTheDocument();
    expect(screen.queryByText('Grants')).not.toBeInTheDocument();
  });

  it('echoes back who the link is for and what it grants', () => {
    render(
      <InviteLinkPanel {...base} inviteUrl="https://carevance.app/accept-invite/abc" role="manager" expiresInHours={72} />,
    );

    // Both were chosen above and sent with the request, but neither was shown
    // back — so there was nothing to check before pasting a single-use URL.
    expect(screen.getByText('ravi@acme.in')).toBeInTheDocument();
    expect(screen.getByText('manager')).toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
  });

  it('omits the expiry when the caller does not supply one', () => {
    render(<InviteLinkPanel {...base} inviteUrl="https://carevance.app/accept-invite/abc" role="employee" />);

    expect(screen.queryByText('Expires')).not.toBeInTheDocument();
  });

  it('confirms a copy instead of silently snapping back', async () => {
    const onCopy = vi.fn();
    const user = userEvent.setup();
    render(
      <InviteLinkPanel {...base} onCopy={onCopy} inviteUrl="https://carevance.app/accept-invite/abc" />,
    );

    await user.click(screen.getByRole('button', { name: /copy link/i }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent(/copied/i);
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('relabels generate once a link exists, because a second press replaces it', () => {
    const { rerender } = render(<InviteLinkPanel {...base} />);
    expect(screen.getByRole('button', { name: 'Generate Invite Link' })).toBeInTheDocument();

    rerender(<InviteLinkPanel {...base} inviteUrl="https://carevance.app/accept-invite/abc" />);
    expect(screen.getByRole('button', { name: /generate a new link/i })).toBeInTheDocument();
  });
});
