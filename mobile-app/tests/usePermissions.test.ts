import { resolveHierarchyLevel, isElevated, isManager, canApprove } from '../src/hooks/usePermissions';
import type { User } from '../src/types';

const mk = (overrides: Partial<User>): User => ({
  id: 1,
  name: 'Test',
  email: 'test@carevance.test',
  ...overrides,
});

describe('usePermissions hierarchy_level resolution', () => {
  it('super_admin resolves to elevated (level < 100)', () => {
    expect(resolveHierarchyLevel(mk({ role: 'super_admin' }))).toBe(10);
    expect(isElevated(mk({ role: 'super_admin' }))).toBe(true);
    expect(isManager(mk({ role: 'super_admin' }))).toBe(true);
    expect(canApprove(mk({ role: 'super_admin' }))).toBe(true);
  });

  it('admin resolves to elevated (level < 100)', () => {
    expect(resolveHierarchyLevel(mk({ role: 'admin' }))).toBe(10);
    expect(isManager(mk({ role: 'admin' }))).toBe(true);
    expect(canApprove(mk({ role: 'admin' }))).toBe(true);
  });

  it('manager resolves to elevated (level < 100)', () => {
    expect(resolveHierarchyLevel(mk({ role: 'manager' }))).toBe(50);
    expect(isManager(mk({ role: 'manager' }))).toBe(true);
    expect(canApprove(mk({ role: 'manager' }))).toBe(true);
  });

  it('plain employee resolves to NOT elevated (level 100)', () => {
    expect(resolveHierarchyLevel(mk({ role: 'employee' }))).toBe(100);
    expect(isElevated(mk({ role: 'employee' }))).toBe(false);
    expect(isManager(mk({ role: 'employee' }))).toBe(false);
    expect(canApprove(mk({ role: 'employee' }))).toBe(false);
  });

  it('custom role with role=employee but elevated hierarchy_level (10) resolves to manager-level access', () => {
    const custom = mk({ role: 'employee', hierarchy_level: 10 });
    expect(resolveHierarchyLevel(custom)).toBe(10);
    expect(isElevated(custom)).toBe(true);
    expect(isManager(custom)).toBe(true);
    expect(canApprove(custom)).toBe(true);
  });

  it('custom role with role=employee but elevated hierarchy_level (30) resolves to manager-level access', () => {
    const custom = mk({ role: 'employee', hierarchy_level: 30 });
    expect(resolveHierarchyLevel(custom)).toBe(30);
    expect(isManager(custom)).toBe(true);
    expect(canApprove(custom)).toBe(true);
  });

  it('custom role with role=employee and hierarchy_level 100 stays NOT elevated (matches current qa.customrole data)', () => {
    const custom = mk({ role: 'employee', hierarchy_level: 100 });
    expect(isManager(custom)).toBe(false);
    expect(canApprove(custom)).toBe(false);
  });

  it('explicit hierarchy_level always wins over the role-string default', () => {
    expect(resolveHierarchyLevel(mk({ role: 'employee', hierarchy_level: 10 }))).toBe(10);
    expect(resolveHierarchyLevel(mk({ role: 'admin', hierarchy_level: 100 }))).toBe(100);
  });

  it('null/undefined user resolves to NOT elevated (safe default)', () => {
    expect(isManager(null)).toBe(false);
    expect(isManager(undefined)).toBe(false);
    expect(canApprove(null)).toBe(false);
  });
});
