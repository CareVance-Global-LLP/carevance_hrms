import { Fragment } from 'react';
import CustomSelect from '@/components/ui/CustomSelect';
import { InviteOption, InviteUserRole, maxJoiningDate, RecipientOverride } from '@/services/addUser';

/**
 * Above this many recipients the per-person table is replaced by a pointer to
 * the CSV tab.
 *
 * Chosen to cover the ad-hoc hire batch without turning the drawer into a
 * data-entry grid. It also bounds the request count: `inviteByEmail` sends one
 * call per distinct combination of role, departments, job title and joining
 * date, so ten fully-different rows is ten calls and no more. Past the limit
 * everybody takes the batch defaults and it collapses back to one call.
 */
export const RECIPIENT_TABLE_LIMIT = 10;

/** Display names for the three built-in access levels. */
export const ROLE_LABELS: Record<InviteUserRole, string> = {
  employee: 'Employee',
  manager: 'Manager',
  admin: 'Admin',
};

/**
 * Which columns offer "apply to all".
 *
 * Kept as data rather than four near-identical handlers because the header
 * button, its enabled check and the write are otherwise the same three lines
 * repeated per column.
 */
type FillableColumn = 'department' | 'jobTitle' | 'role' | 'joiningDate';

interface RecipientDetailsTableProps {
  emails: string[];
  overrides: Record<string, RecipientOverride>;
  onOverrideChange: (email: string, patch: RecipientOverride) => void;
  employeeCodeByEmail: Record<string, string>;
  onEmployeeCodeChange: (email: string, code: string) => void;
  departments: InviteOption[];
  departmentsLoading?: boolean;
  allowedRoles: InviteUserRole[];
  defaultGroupIds: number[];
  defaultJobTitle: string;
  defaultJoiningDate: string;
  defaultRole: InviteUserRole;
  /** The custom role's name when one is chosen above, else null. */
  customRoleName?: string | null;
}

export default function RecipientDetailsTable({
  emails,
  overrides,
  onOverrideChange,
  employeeCodeByEmail,
  onEmployeeCodeChange,
  departments,
  departmentsLoading = false,
  allowedRoles,
  defaultGroupIds,
  defaultJobTitle,
  defaultJoiningDate,
  defaultRole,
  customRoleName,
}: RecipientDetailsTableProps) {
  const keyOf = (email: string) => email.trim().toLowerCase();
  const overrideFor = (email: string): RecipientOverride => overrides[keyOf(email)] || {};

  const defaultDepartmentLabel = defaultGroupIds.length === 0
    ? 'none'
    : defaultGroupIds.length === 1
      ? departments.find((option) => option.id === defaultGroupIds[0])?.name || `#${defaultGroupIds[0]}`
      : `${defaultGroupIds.length} departments`;

  const departmentOptions = [
    { value: '', label: `Use default (${defaultDepartmentLabel})` },
    ...departments.map((option) => ({ value: String(option.id), label: option.name })),
  ];

  const roleOptions = [
    { value: '', label: `Use default (${customRoleName || ROLE_LABELS[defaultRole]})` },
    ...allowedRoles.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
  ];

  /*
   * Read the first row's value for a column, so "apply to all" has something to
   * copy. Deliberately the first row rather than the first non-empty one: the
   * button means "they are all like this one", and silently sourcing from row
   * four would make the result impossible to predict from the screen.
   */
  const firstRowValue = (column: FillableColumn): string => {
    const override = emails.length > 0 ? overrideFor(emails[0]) : {};

    if (column === 'department') return override.groupId ? String(override.groupId) : '';
    if (column === 'jobTitle') return override.jobTitle || '';
    if (column === 'role') return override.role || '';
    return override.joiningDate || '';
  };

  const applyToAll = (column: FillableColumn) => {
    const value = firstRowValue(column);

    emails.slice(1).forEach((email) => {
      if (column === 'department') {
        onOverrideChange(email, { groupId: value ? Number(value) : null });
      } else if (column === 'jobTitle') {
        onOverrideChange(email, { jobTitle: value });
      } else if (column === 'role') {
        onOverrideChange(email, { role: (value || undefined) as InviteUserRole | undefined });
      } else {
        onOverrideChange(email, { joiningDate: value });
      }
    });
  };

  const ColumnHeader = ({ label, column }: { label: string; column?: FillableColumn }) => (
    <th scope="col" className="px-3 py-2 text-left align-bottom font-semibold text-slate-600">
      <span className="block">{label}</span>
      {column && emails.length > 1 ? (
        <button
          type="button"
          onClick={() => applyToAll(column)}
          disabled={!firstRowValue(column)}
          aria-label={`Apply the first recipient's ${label.toLowerCase()} to everyone`}
          className="mt-0.5 text-[11px] font-medium text-sky-600 transition hover:text-sky-800 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Apply to all
        </button>
      ) : null}
    </th>
  );

  if (emails.length === 0) {
    return null;
  }

  /*
   * Hidden entirely for a large paste. This is for the handful-of-people case;
   * the CSV tab already carries every one of these as a column, and typing
   * fifty rows into a drawer is the wrong tool.
   */
  if (emails.length > RECIPIENT_TABLE_LIMIT) {
    return (
      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
        {emails.length} recipients — everyone here gets the defaults above. Use the{' '}
        <span className="font-semibold text-slate-700">Add by CSV</span> tab to give each person their
        own department, job title, employee code or joining date in bulk.
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-slate-700">
          Per-recipient details{' '}
          <span className="font-normal text-slate-400">
            (optional — anything left on &ldquo;use default&rdquo; takes the values above)
          </span>
        </p>
        <p className="text-[11px] text-slate-400">
          {emails.length} recipient{emails.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[56rem] border-separate border-spacing-y-1 text-xs">
          <thead>
            <tr>
              <ColumnHeader label="Recipient" />
              <ColumnHeader label="Employee code" />
              <ColumnHeader label="Department" column="department" />
              <ColumnHeader label="Job title" column="jobTitle" />
              <ColumnHeader label="Access level" column="role" />
              <ColumnHeader label="Joining date" column="joiningDate" />
            </tr>
          </thead>
          <tbody>
            {emails.map((email) => {
              const override = overrideFor(email);

              return (
                <Fragment key={`row-${email}`}>
                  <tr className="bg-white">
                    <td className="max-w-[14rem] truncate rounded-l-md px-3 py-2 text-slate-600" title={email}>
                      {email}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        maxLength={80}
                        value={employeeCodeByEmail[keyOf(email)] ?? ''}
                        onChange={(event) => onEmployeeCodeChange(email, event.target.value)}
                        aria-label={`Employee code for ${email}`}
                        placeholder="e.g., EMP-001"
                        className="w-full min-w-[7rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CustomSelect
                        id={`department-${keyOf(email)}`}
                        ariaLabel={`Department for ${email}`}
                        options={departmentOptions}
                        value={override.groupId ? String(override.groupId) : ''}
                        onChange={(value) => onOverrideChange(email, { groupId: value ? Number(value) : null })}
                        disabled={departmentsLoading}
                        className="min-w-[10rem] py-1 text-xs"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        maxLength={255}
                        value={override.jobTitle ?? ''}
                        onChange={(event) => onOverrideChange(email, { jobTitle: event.target.value })}
                        aria-label={`Job title for ${email}`}
                        placeholder={defaultJobTitle || 'e.g., Support Analyst'}
                        className="w-full min-w-[9rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CustomSelect
                        id={`access-level-${keyOf(email)}`}
                        ariaLabel={`Access level for ${email}`}
                        options={roleOptions}
                        value={override.role || ''}
                        onChange={(value) =>
                          onOverrideChange(email, { role: (value || undefined) as InviteUserRole | undefined })
                        }
                        className="min-w-[8rem] py-1 text-xs"
                      />
                    </td>
                    <td className="rounded-r-md px-3 py-2">
                      <input
                        type="date"
                        max={maxJoiningDate}
                        value={override.joiningDate ?? ''}
                        onChange={(event) => onOverrideChange(email, { joiningDate: event.target.value })}
                        aria-label={`Joining date for ${email}`}
                        className="w-full min-w-[8.5rem] rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-sky-300"
                      />
                    </td>
                  </tr>
                  {/*
                    A custom role resolves to a base role server-side, so a row
                    that picks a built-in level gets the built-in and not the
                    custom one. Said out loud rather than discarded silently —
                    that mismatch is why the per-chip role selector was removed.
                  */}
                  {override.role && customRoleName ? (
                    <tr>
                      <td colSpan={6} className="px-3 pb-1 text-[11px] text-amber-700">
                        {email} gets built-in {ROLE_LABELS[override.role]} access, not {customRoleName}.
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {defaultJoiningDate ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Blank joining dates use {defaultJoiningDate}, the default above.
        </p>
      ) : null}
    </div>
  );
}
