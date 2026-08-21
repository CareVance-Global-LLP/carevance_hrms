import { describe, expect, it } from 'vitest';
import { groupRecipientsForInvite, InviteBatchDefaults, resolveRecipient } from './addUser';

const defaults = (over: Partial<InviteBatchDefaults> = {}): InviteBatchDefaults => ({
  role: 'employee',
  groupIds: [],
  ...over,
});

/** Just the shape each request carries, for readable assertions. */
const shapes = (groups: ReturnType<typeof groupRecipientsForInvite>) =>
  groups.map(({ emails, ...rest }) => ({ ...rest, emails }));

describe('groupRecipientsForInvite — one request per distinct shape', () => {
  it('returns one group when nobody overrides anything', () => {
    const groups = groupRecipientsForInvite(['a@x.in', 'b@x.in'], defaults({ groupIds: [7] }));

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ role: 'employee', groupIds: [7], emails: ['a@x.in', 'b@x.in'] });
  });

  it('handles an empty list', () => {
    expect(groupRecipientsForInvite([], defaults())).toEqual([]);
  });

  it('splits a mixed-role batch into one group per role', () => {
    // StoreInvitationRequest takes a single `role` per request, so two employees
    // and a manager cannot be one call — this is what makes them two.
    const groups = groupRecipientsForInvite(
      ['asha@x.in', 'ravi@x.in', 'priya@x.in'],
      defaults(),
      { 'ravi@x.in': { role: 'manager' } },
    );

    // Both employees land in ONE group even though a manager sits between them
    // in the input — each group is an HTTP request, so merging halves the calls.
    expect(shapes(groups)).toEqual([
      { role: 'employee', roleId: null, groupIds: [], jobTitle: undefined, joiningDate: undefined, emails: ['asha@x.in', 'priya@x.in'] },
      { role: 'manager', roleId: null, groupIds: [], jobTitle: undefined, joiningDate: undefined, emails: ['ravi@x.in'] },
    ]);
  });

  it('matches overrides case-insensitively and ignores surrounding space', () => {
    const groups = groupRecipientsForInvite([' Ravi@X.in '], defaults(), { 'ravi@x.in': { role: 'admin' } });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ role: 'admin', emails: [' Ravi@X.in '] });
  });

  it('ignores an override for somebody not in the list', () => {
    const groups = groupRecipientsForInvite(['a@x.in'], defaults(), { 'gone@x.in': { role: 'admin' } });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ role: 'employee', emails: ['a@x.in'] });
  });

  it('orders groups by first appearance, and merges across the gap', () => {
    const groups = groupRecipientsForInvite(
      ['one@x.in', 'two@x.in', 'three@x.in'],
      defaults(),
      { 'one@x.in': { role: 'admin' }, 'three@x.in': { role: 'admin' } },
    );

    expect(groups.map((group) => [group.role, group.emails])).toEqual([
      ['admin', ['one@x.in', 'three@x.in']],
      ['employee', ['two@x.in']],
    ]);
  });

  it('emits one group per role no matter how the roles interleave', () => {
    const emails = Array.from({ length: 20 }, (_, i) => `p${i}@x.in`);
    const overrides = Object.fromEntries(
      emails.filter((_, i) => i % 2 === 0).map((email) => [email, { role: 'manager' as const }]),
    );

    // 20 recipients alternating between two roles is 2 requests, not 20.
    expect(groupRecipientsForInvite(emails, defaults(), overrides)).toHaveLength(2);
  });
});

describe('groupRecipientsForInvite — the fields beyond role', () => {
  it('splits on department, which is the case that used to force a second send', () => {
    const groups = groupRecipientsForInvite(
      ['sales1@x.in', 'ops@x.in', 'sales2@x.in'],
      defaults({ groupIds: [1] }),
      { 'sales1@x.in': { groupId: 2 }, 'sales2@x.in': { groupId: 2 } },
    );

    expect(groups.map((group) => [group.groupIds, group.emails])).toEqual([
      [[2], ['sales1@x.in', 'sales2@x.in']],
      [[1], ['ops@x.in']],
    ]);
  });

  it('replaces the batch departments rather than adding to them', () => {
    // `/invitations` writes exactly the group_ids it is given. Merging here
    // would leave a person moved to Sales still sitting in Operations.
    const [group] = groupRecipientsForInvite(['a@x.in'], defaults({ groupIds: [1, 4] }), {
      'a@x.in': { groupId: 9 },
    });

    expect(group.groupIds).toEqual([9]);
  });

  it('treats a null groupId as "use the batch departments"', () => {
    const [group] = groupRecipientsForInvite(['a@x.in'], defaults({ groupIds: [1] }), {
      'a@x.in': { groupId: null, jobTitle: 'Analyst' },
    });

    expect(group.groupIds).toEqual([1]);
    expect(group.jobTitle).toBe('Analyst');
  });

  it('splits on job title and on joining date', () => {
    const byTitle = groupRecipientsForInvite(['a@x.in', 'b@x.in'], defaults({ jobTitle: 'Support' }), {
      'b@x.in': { jobTitle: 'Team Lead' },
    });
    expect(byTitle.map((group) => group.jobTitle)).toEqual(['Support', 'Team Lead']);

    const byDate = groupRecipientsForInvite(['a@x.in', 'b@x.in'], defaults({ joiningDate: '2026-09-01' }), {
      'b@x.in': { joiningDate: '2026-10-01' },
    });
    expect(byDate.map((group) => group.joiningDate)).toEqual(['2026-09-01', '2026-10-01']);
  });

  it('does not split on a blank override, which is what an untouched row sends', () => {
    const groups = groupRecipientsForInvite(
      ['a@x.in', 'b@x.in'],
      defaults({ jobTitle: 'Support' }),
      { 'b@x.in': { jobTitle: '   ' } },
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].jobTitle).toBe('Support');
  });

  it('carries a custom role through untouched rows and drops it on an overridden one', () => {
    // A custom role refines the hierarchy but still resolves to a base role
    // server-side. Pairing it with a different base role is the contradiction
    // the per-chip role selector was removed for, so the override wins alone.
    const groups = groupRecipientsForInvite(
      ['keeps@x.in', 'overrides@x.in'],
      defaults({ roleId: 42 }),
      { 'overrides@x.in': { role: 'manager' } },
    );

    expect(groups.map((group) => [group.role, group.roleId])).toEqual([
      ['employee', 42],
      ['manager', null],
    ]);
  });
});

describe('resolveRecipient', () => {
  it('returns the batch defaults verbatim when there is no override', () => {
    expect(
      resolveRecipient('a@x.in', defaults({ roleId: 7, groupIds: [3], jobTitle: 'Support', joiningDate: '2026-09-01' })),
    ).toEqual({
      role: 'employee',
      roleId: 7,
      groupIds: [3],
      jobTitle: 'Support',
      joiningDate: '2026-09-01',
    });
  });
});
