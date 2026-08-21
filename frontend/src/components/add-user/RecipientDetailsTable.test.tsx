import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RecipientDetailsTable, { RECIPIENT_TABLE_LIMIT } from './RecipientDetailsTable';
import { InviteOption, RecipientOverride } from '@/services/addUser';

const departments: InviteOption[] = [
  { id: 1, name: 'Operations', description: '3 members' },
  { id: 2, name: 'Sales', description: '1 member' },
  { id: 3, name: 'Finance', description: '0 members' },
];

const renderTable = (props: Partial<React.ComponentProps<typeof RecipientDetailsTable>> = {}) => {
  const onOverrideChange = vi.fn();
  const onEmployeeCodeChange = vi.fn();

  render(
    <RecipientDetailsTable
      emails={['asha@acme.in', 'ravi@acme.in']}
      overrides={{}}
      onOverrideChange={onOverrideChange}
      employeeCodeByEmail={{}}
      onEmployeeCodeChange={onEmployeeCodeChange}
      departments={departments}
      allowedRoles={['employee', 'manager', 'admin']}
      defaultGroupIds={[1]}
      defaultJobTitle=""
      defaultJoiningDate=""
      defaultRole="employee"
      {...props}
    />
  );

  return { onOverrideChange, onEmployeeCodeChange };
};

describe('RecipientDetailsTable — what each row can carry', () => {
  it('gives every recipient their own controls', () => {
    renderTable();

    ['asha@acme.in', 'ravi@acme.in'].forEach((email) => {
      expect(screen.getByRole('textbox', { name: `Employee code for ${email}` })).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: `Job title for ${email}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Department for ${email}` })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Access level for ${email}` })).toBeInTheDocument();
    });
  });

  it('names the batch default in the "use default" option so a blank row is not a mystery', () => {
    renderTable();

    // Both rows show it, hence getAllBy.
    expect(screen.getAllByText('Use default (Operations)')).toHaveLength(2);
  });

  it('summarises a multi-department default rather than naming only the first', () => {
    renderTable({ defaultGroupIds: [1, 2] });

    expect(screen.getAllByText('Use default (2 departments)')).toHaveLength(2);
  });

  it('reports a department override as replacing the default, not adding to it', async () => {
    const user = userEvent.setup();
    const { onOverrideChange } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Department for ravi@acme.in' }));
    await user.click(screen.getByRole('option', { name: 'Sales' }));

    expect(onOverrideChange).toHaveBeenCalledWith('ravi@acme.in', { groupId: 2 });
  });

  it('sends null when a row goes back to the default, so the key can be cleared', async () => {
    const user = userEvent.setup();
    const { onOverrideChange } = renderTable({
      overrides: { 'ravi@acme.in': { groupId: 2 } },
    });

    await user.click(screen.getByRole('button', { name: 'Department for ravi@acme.in' }));
    await user.click(screen.getByRole('option', { name: 'Use default (Operations)' }));

    expect(onOverrideChange).toHaveBeenCalledWith('ravi@acme.in', { groupId: null });
  });

  it('keys overrides case-insensitively, matching what the service looks up', () => {
    renderTable({
      emails: ['Asha@Acme.in'],
      overrides: { 'asha@acme.in': { jobTitle: 'Team Lead' } },
    });

    expect(screen.getByRole('textbox', { name: 'Job title for Asha@Acme.in' })).toHaveValue('Team Lead');
  });

  it('shows the batch job title as the placeholder so a blank row reads as inherited', () => {
    renderTable({ defaultJobTitle: 'Support Analyst' });

    expect(screen.getByRole('textbox', { name: 'Job title for asha@acme.in' }))
      .toHaveAttribute('placeholder', 'Support Analyst');
  });
});

describe('RecipientDetailsTable — apply to all', () => {
  it('is disabled until the first row has something worth copying', () => {
    renderTable();

    expect(screen.getByRole('button', { name: /apply the first recipient's department/i })).toBeDisabled();
  });

  it('copies the first row down to everyone else, and not to itself', async () => {
    const user = userEvent.setup();
    const { onOverrideChange } = renderTable({
      emails: ['asha@acme.in', 'ravi@acme.in', 'priya@acme.in'],
      overrides: { 'asha@acme.in': { groupId: 3 } },
    });

    await user.click(screen.getByRole('button', { name: /apply the first recipient's department/i }));

    expect(onOverrideChange.mock.calls).toEqual([
      ['ravi@acme.in', { groupId: 3 }],
      ['priya@acme.in', { groupId: 3 }],
    ]);
  });

  it('offers nothing to copy when there is only one recipient', () => {
    renderTable({ emails: ['asha@acme.in'] });

    expect(screen.queryByRole('button', { name: /apply the first recipient/i })).not.toBeInTheDocument();
  });
});

describe('RecipientDetailsTable — the custom role boundary', () => {
  it('says out loud that an overridden row loses the admin-defined role', async () => {
    renderTable({
      overrides: { 'ravi@acme.in': { role: 'manager' } },
      customRoleName: 'Shift Supervisor',
    });

    expect(screen.getByText(/gets built-in Manager access, not Shift Supervisor/i)).toBeInTheDocument();
  });

  it('stays quiet when the batch default is a built-in role', () => {
    renderTable({ overrides: { 'ravi@acme.in': { role: 'manager' } } });

    expect(screen.queryByText(/gets built-in/i)).not.toBeInTheDocument();
  });

  it('offers only the roles this admin may assign', async () => {
    const user = userEvent.setup();
    renderTable({ allowedRoles: ['employee'] });

    await user.click(screen.getByRole('button', { name: 'Access level for asha@acme.in' }));

    expect(screen.getByRole('option', { name: 'Employee' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument();
  });
});

describe('RecipientDetailsTable — the size ceiling', () => {
  it('renders the table up to the limit', () => {
    const emails = Array.from({ length: RECIPIENT_TABLE_LIMIT }, (_, i) => `p${i}@acme.in`);
    renderTable({ emails });

    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('points a large paste at the CSV tab instead of rendering fifty rows', () => {
    const emails = Array.from({ length: RECIPIENT_TABLE_LIMIT + 1 }, (_, i) => `p${i}@acme.in`);
    renderTable({ emails });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/Add by CSV/)).toBeInTheDocument();
  });

  it('renders nothing at all with no recipients', () => {
    const { container } = render(
      <RecipientDetailsTable
        emails={[]}
        overrides={{} as Record<string, RecipientOverride>}
        onOverrideChange={vi.fn()}
        employeeCodeByEmail={{}}
        onEmployeeCodeChange={vi.fn()}
        departments={departments}
        allowedRoles={['employee']}
        defaultGroupIds={[]}
        defaultJobTitle=""
        defaultJoiningDate=""
        defaultRole="employee"
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
