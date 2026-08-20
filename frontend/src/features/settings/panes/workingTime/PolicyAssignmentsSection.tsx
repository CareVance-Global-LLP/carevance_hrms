import { useCallback, useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { userApi } from '@/services/api';
import SettingsCard from '../../components/SettingsCard';
import SegmentedControl from '../../components/SegmentedControl';
import {
  overtimePolicyApi,
  penalisationPolicyApi,
  shiftAllowancePolicyApi,
  weeklyOffPolicyApi,
  type PolicyAssignment,
  type PolicyKind,
} from '@/services/workingTimeApi';

/** Every kind resolves the same way, so one screen assigns all four. */
const KINDS: Array<{
  value: PolicyKind;
  label: string;
  endpoints: {
    list: () => Promise<{ data: { data: Array<{ id: number; name: string; is_active: boolean }> } }>;
    assignments: () => Promise<{ data: { data: PolicyAssignment[] } }>;
    assign: (payload: {
      user_id: number;
      policy_id: number;
      effective_from: string;
      effective_to?: string | null;
    }) => Promise<unknown>;
    unassign: (id: number) => Promise<unknown>;
  };
}> = [
  { value: 'weekly-off', label: 'Weekly off', endpoints: weeklyOffPolicyApi },
  { value: 'penalisation', label: 'Penalisation', endpoints: penalisationPolicyApi },
  { value: 'overtime', label: 'Overtime', endpoints: overtimePolicyApi },
  { value: 'shift-allowance', label: 'Shift allowance', endpoints: shiftAllowancePolicyApi },
];

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Who is on which policy.
 *
 * Assignment is per person and dated, exactly as a shift roster is. Moving
 * somebody to a different policy is a NEW assignment starting later, never an
 * edit — so a payroll re-run for an earlier month still resolves the policy
 * that was actually in force then. The latest effective_from wins where two
 * windows overlap, which is what makes an open-ended assignment safe to leave
 * in place.
 *
 * Somebody with no assignment at all is not unpoliced: they fall to the
 * workspace default, and then to the shift's own columns. That is stated on
 * the screen because the empty state otherwise reads as "no rules apply".
 */
export default function PolicyAssignmentsSection() {
  const toast = useToast();

  const [kind, setKind] = useState<PolicyKind>('weekly-off');
  const [policies, setPolicies] = useState<Array<{ id: number; name: string; is_active: boolean }>>([]);
  const [assignments, setAssignments] = useState<PolicyAssignment[]>([]);
  const [people, setPeople] = useState<Array<{ id: number; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [userId, setUserId] = useState('');
  const [policyId, setPolicyId] = useState('');
  const [from, setFrom] = useState(todayIso);
  const [until, setUntil] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);

  const active = useMemo(() => KINDS.find((item) => item.value === kind) as (typeof KINDS)[number], [kind]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [policyResponse, assignmentResponse, peopleResponse] = await Promise.all([
        active.endpoints.list(),
        active.endpoints.assignments(),
        userApi.getAll({ simple: true }),
      ]);
      setPolicies(policyResponse.data.data || []);
      setAssignments(assignmentResponse.data.data || []);
      setPeople(
        (peopleResponse.data || []).map((person: { id: number; name?: string | null }) => ({
          id: person.id,
          name: person.name || `Employee #${person.id}`,
        }))
      );
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Could not load assignments.');
    } finally {
      setIsLoading(false);
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person.name])),
    [people]
  );

  const assign = async () => {
    if (!userId || !policyId || !from) {
      toast.show({ kind: 'error', message: 'Pick a person, a policy and a start date.' });
      return;
    }

    setIsAssigning(true);
    try {
      await active.endpoints.assign({
        user_id: Number(userId),
        policy_id: Number(policyId),
        effective_from: from,
        effective_to: until || null,
      });
      toast.show({ kind: 'success', message: `${active.label} policy assigned.` });
      setUntil('');
      await load();
    } catch (e: any) {
      const fieldErrors = e?.response?.data?.errors as Record<string, string[]> | undefined;
      const firstFieldError = fieldErrors ? Object.values(fieldErrors)[0]?.[0] : null;
      toast.show({
        kind: 'error',
        message: firstFieldError || e?.response?.data?.message || 'Could not assign the policy.',
      });
    } finally {
      setIsAssigning(false);
    }
  };

  const unassign = async (assignment: PolicyAssignment) => {
    try {
      await active.endpoints.unassign(assignment.id);
      toast.show({ kind: 'success', message: 'Assignment removed.' });
      await load();
    } catch (e: any) {
      toast.show({
        kind: 'error',
        message: e?.response?.data?.message || 'Could not remove the assignment.',
      });
    }
  };

  return (
    <SettingsCard
      title="Who is on which policy"
      description="Assignment is per person and dated. Re-assigning someone is a new assignment starting later, not an edit — so an earlier month still resolves the policy that was in force then. Anyone with no assignment falls to the workspace default, and then to the shift's own settings."
    >
      <SegmentedControl
        ariaLabel="Which policy kind to assign"
        value={kind}
        onChange={(value) => {
          setKind(value as PolicyKind);
          setPolicyId('');
        }}
        options={KINDS.map((item) => ({ value: item.value, label: item.label }))}
        className="mb-4"
      />

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}

      <div className="mb-4 grid items-end gap-3 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-5">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="assign-user">
            Employee
          </label>
          <select
            id="assign-user"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select a person</option>
            {people.map((person) => (
              <option key={person.id} value={String(person.id)}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="assign-policy">
            Policy
          </label>
          <select
            id="assign-policy"
            value={policyId}
            onChange={(event) => setPolicyId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          >
            <option value="">Select a policy</option>
            {policies
              .filter((policy) => policy.is_active)
              .map((policy) => (
                <option key={policy.id} value={String(policy.id)}>
                  {policy.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="assign-from">
            From
          </label>
          <input
            id="assign-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700" htmlFor="assign-until">
            Until
            <span className="ml-1 font-normal text-slate-500">optional</span>
          </label>
          <input
            id="assign-until"
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-surface-card px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="sm:col-span-5">
          <Button onClick={assign} loading={isAssigning} disabled={isAssigning}>
            Assign {active.label.toLowerCase()} policy
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-16 animate-pulse rounded-xl bg-surface-sunken" />
      ) : assignments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-600">
          Nobody is on a {active.label.toLowerCase()} policy of their own. Everyone falls to the
          workspace default, if one is set.
        </p>
      ) : (
        <div className="space-y-2">
          {assignments.map((assignment) => {
            const personName =
              assignment.user?.name
              || peopleById.get(assignment.user_id)
              || `Employee #${assignment.user_id}`;

            return (
              <div
                key={assignment.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-surface-sunken p-3"
              >
                <span className="min-w-[9rem] flex-1 truncate text-sm font-medium text-slate-900">
                  {personName}
                </span>
                <span className="text-xs text-slate-600">
                  {assignment.policy?.name || 'Policy removed'}
                </span>
                <span className="text-xs text-slate-600">
                  {assignment.effective_from}
                  {assignment.effective_to ? ` to ${assignment.effective_to}` : ' onwards'}
                </span>
                <button
                  type="button"
                  onClick={() => unassign(assignment)}
                  aria-label={`Remove ${personName} from ${assignment.policy?.name || 'this policy'}`}
                  className="rounded-md p-2 text-slate-500 transition hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </SettingsCard>
  );
}
