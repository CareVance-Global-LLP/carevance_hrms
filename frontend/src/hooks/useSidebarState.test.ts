import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSidebarState } from './useSidebarState';

describe('useSidebarState', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts expanded for someone who has never set it', () => {
    const { result } = renderHook(() => useSidebarState(1));
    expect(result.current.collapsed).toBe(false);
  });

  it('remembers the collapsed choice across mounts', () => {
    const first = renderHook(() => useSidebarState(1));
    act(() => first.result.current.toggleCollapsed());
    expect(first.result.current.collapsed).toBe(true);

    first.unmount();
    const second = renderHook(() => useSidebarState(1));
    expect(second.result.current.collapsed).toBe(true);
  });

  it('keeps one user’s layout out of another’s session', () => {
    const mine = renderHook(() => useSidebarState(1));
    act(() => mine.result.current.toggleCollapsed());
    mine.unmount();

    const theirs = renderHook(() => useSidebarState(2));
    expect(theirs.result.current.collapsed).toBe(false);
  });

  it('switches state when the user id changes without remounting', () => {
    const { result, rerender } = renderHook(({ id }) => useSidebarState(id), { initialProps: { id: 1 } });
    act(() => result.current.toggleCollapsed());
    expect(result.current.collapsed).toBe(true);

    rerender({ id: 2 });
    expect(result.current.collapsed).toBe(false);
  });

  it('toggles a group open and closed', () => {
    const { result } = renderHook(() => useSidebarState(1));
    act(() => result.current.toggleGroup('Attendance'));
    expect(result.current.isGroupOpen('Attendance')).toBe(true);

    act(() => result.current.toggleGroup('Attendance'));
    expect(result.current.isGroupOpen('Attendance')).toBe(false);
  });

  it('persists open groups', () => {
    const first = renderHook(() => useSidebarState(1));
    act(() => first.result.current.toggleGroup('Payroll'));
    first.unmount();

    const second = renderHook(() => useSidebarState(1));
    expect(second.result.current.isGroupOpen('Payroll')).toBe(true);
  });

  /*
   * The regression: the old effect only ever added, so visiting three sections
   * left three groups open and the rail grew until it scrolled.
   */
  it('focusGroup replaces the open set instead of accumulating', () => {
    const { result } = renderHook(() => useSidebarState(1));

    act(() => result.current.focusGroup('Attendance'));
    act(() => result.current.focusGroup('Reports'));
    act(() => result.current.focusGroup('Payroll'));

    expect(result.current.isGroupOpen('Payroll')).toBe(true);
    expect(result.current.isGroupOpen('Attendance')).toBe(false);
    expect(result.current.isGroupOpen('Reports')).toBe(false);
    expect(result.current.openGroups.size).toBe(1);
  });

  it('focusGroup(null) closes everything', () => {
    const { result } = renderHook(() => useSidebarState(1));
    act(() => result.current.focusGroup('Attendance'));
    act(() => result.current.focusGroup(null));
    expect(result.current.openGroups.size).toBe(0);
  });

  it('is a no-op when focusing the group that is already the only one open', () => {
    const { result } = renderHook(() => useSidebarState(1));
    act(() => result.current.focusGroup('Attendance'));
    const before = result.current.openGroups;
    act(() => result.current.focusGroup('Attendance'));
    expect(result.current.openGroups).toBe(before);
  });

  it('setCollapsed writes the value directly', () => {
    const { result } = renderHook(() => useSidebarState(1));
    act(() => result.current.setCollapsed(true));
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.setCollapsed(false));
    expect(result.current.collapsed).toBe(false);
  });

  it('survives corrupt storage rather than throwing', () => {
    window.localStorage.setItem('carevance.sidebar.groups.1', 'not json');
    const { result } = renderHook(() => useSidebarState(1));
    expect(result.current.openGroups.size).toBe(0);
  });

  it('ignores non-string entries in stored groups', () => {
    window.localStorage.setItem('carevance.sidebar.groups.1', JSON.stringify(['Payroll', 42, null]));
    const { result } = renderHook(() => useSidebarState(1));
    expect(Array.from(result.current.openGroups)).toEqual(['Payroll']);
  });

  it('namespaces anonymous users rather than sharing a key', () => {
    const anon = renderHook(() => useSidebarState(null));
    act(() => anon.result.current.toggleCollapsed());
    expect(window.localStorage.getItem('carevance.sidebar.collapsed.anonymous')).toBe('1');
  });
});
