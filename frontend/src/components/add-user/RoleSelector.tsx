import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, UserRound, UsersRound, BadgeCheck } from 'lucide-react';
import { FieldLabel } from '@/components/ui/FormField';
import { roleApi } from '@/services/api';
import { InviteUserRole } from '@/services/addUser';

const roleOptions: Array<{
  value: InviteUserRole;
  label: string;
  description: string;
  icon: typeof UserRound;
}> = [
  {
    value: 'employee',
    label: 'Employee',
    description: 'Track work and attendance.',
    icon: UserRound,
  },
  {
    value: 'manager',
    label: 'Manager',
    description: 'Monitor team activity and approvals.',
    icon: UsersRound,
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full platform control and configuration.',
    icon: ShieldCheck,
  },
];

/**
 * The base role an admin-defined role corresponds to.
 *
 * A custom role refines the hierarchy — a "Team Lead" at level 60 sits between
 * manager and employee — but it does not replace the base role, because
 * middleware still authorises on that. The server derives this same value and
 * does not trust what the client sends; it is duplicated here only so the UI
 * can grey out a role this admin is not allowed to grant.
 */
export const baseRoleForLevel = (level: number): InviteUserRole => {
  if (level <= 10) return 'admin';
  if (level < 100) return 'manager';
  return 'employee';
};

export interface CustomRoleOption {
  id: number;
  name: string;
  description: string | null;
  hierarchy_level: number;
}

export default function RoleSelector({
  value,
  roleId,
  onChange,
  allowedRoles = roleOptions.map((option) => option.value),
}: {
  value: InviteUserRole;
  /** The admin-defined role, when one is selected instead of a base role. */
  roleId?: number | null;
  onChange: (role: InviteUserRole, roleId: number | null, label: string) => void;
  allowedRoles?: InviteUserRole[];
}) {
  /*
   * Admin-defined roles belong in this list.
   *
   * They were absent entirely, so an organisation that had gone to the trouble
   * of defining "Senior Manager" and "Team Lead" could not invite anyone into
   * either — every joiner landed on one of the three built-ins and had to be
   * re-assigned afterwards from Settings.
   */
  const customRolesQuery = useQuery({
    queryKey: ['roles', 'invite-access-level'],
    queryFn: async () => (await roleApi.list()).data?.data ?? [],
    staleTime: 60_000,
  });

  // Only the ones an admin actually created. System roles are the same three
  // built-ins already rendered above, and listing them twice is the confusion
  // this control is meant to remove.
  const customRoles: CustomRoleOption[] = (customRolesQuery.data ?? [])
    .filter((role) => !role.is_system && role.is_active)
    .filter((role) => allowedRoles.includes(baseRoleForLevel(role.hierarchy_level)))
    .map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      hierarchy_level: role.hierarchy_level,
    }));

  return (
    <div>
      <FieldLabel>Access Level</FieldLabel>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {roleOptions.filter((option) => allowedRoles.includes(option.value)).map((option) => {
          const Icon = option.icon;
          // A base role is only active while no custom role is chosen —
          // otherwise both a built-in and a custom card would look selected.
          const active = !roleId && value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value, null, option.label)}
              className={`rounded-lg border px-4 py-4 text-left transition ${
                active
                  ? 'border-sky-300 bg-sky-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2.5 ${active ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">{option.label}</p>
                  <p className="mt-1 text-sm text-slate-500">{option.description}</p>
                </div>
              </div>
            </button>
          );
        })}

        {customRoles.map((role) => {
          const active = roleId === role.id;
          const base = baseRoleForLevel(role.hierarchy_level);

          return (
            <button
              key={`custom-${role.id}`}
              type="button"
              onClick={() => onChange(base, role.id, role.name)}
              className={`rounded-lg border px-4 py-4 text-left transition ${
                active
                  ? 'border-sky-300 bg-sky-50 shadow-sm'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`rounded-lg p-2.5 ${active ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  <BadgeCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-950">{role.name}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {role.description || `Custom role — ${base} permissions.`}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
