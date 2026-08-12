import { describe, expect, it } from 'vitest';
import { groupEmailsByRole } from './addUser';

describe('groupEmailsByRole', () => {
  it('returns one group when nobody overrides the default', () => {
    expect(groupEmailsByRole(['a@x.in', 'b@x.in'], 'employee')).toEqual([
      ['employee', ['a@x.in', 'b@x.in']],
    ]);
  });

  it('splits a mixed batch into one group per role', () => {
    // StoreInvitationRequest takes a single `role` per request, so two employees
    // and a manager cannot be one call — this is what makes them two.
    const groups = groupEmailsByRole(
      ['asha@x.in', 'ravi@x.in', 'priya@x.in'],
      'employee',
      { 'ravi@x.in': 'manager' },
    );

    // Both employees land in ONE group even though a manager sits between them
    // in the input — each group is an HTTP request, so merging halves the calls.
    expect(groups).toEqual([
      ['employee', ['asha@x.in', 'priya@x.in']],
      ['manager', ['ravi@x.in']],
    ]);
  });

  it('matches overrides case-insensitively and ignores surrounding space', () => {
    const groups = groupEmailsByRole([' Ravi@X.in '], 'employee', { 'ravi@x.in': 'admin' });
    expect(groups).toEqual([['admin', [' Ravi@X.in ']]]);
  });

  it('ignores an override for somebody not in the list', () => {
    const groups = groupEmailsByRole(['a@x.in'], 'employee', { 'gone@x.in': 'admin' });
    expect(groups).toEqual([['employee', ['a@x.in']]]);
  });

  it('orders groups by first appearance, and merges across the gap', () => {
    const groups = groupEmailsByRole(
      ['one@x.in', 'two@x.in', 'three@x.in'],
      'employee',
      { 'one@x.in': 'admin', 'three@x.in': 'admin' },
    );

    expect(groups).toEqual([
      ['admin', ['one@x.in', 'three@x.in']],
      ['employee', ['two@x.in']],
    ]);
  });

  it('emits one group per role no matter how the roles interleave', () => {
    const emails = Array.from({ length: 20 }, (_, i) => `p${i}@x.in`);
    const overrides = Object.fromEntries(
      emails.filter((_, i) => i % 2 === 0).map((email) => [email, 'manager' as const]),
    );

    // 20 recipients alternating between two roles is 2 requests, not 20.
    expect(groupEmailsByRole(emails, 'employee', overrides)).toHaveLength(2);
  });

  it('handles an empty list', () => {
    expect(groupEmailsByRole([], 'employee')).toEqual([]);
  });
});
