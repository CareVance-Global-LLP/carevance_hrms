import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Attendance monitoring panel source', () => {
  it('uses the full employee insights payload so current tool matches monitoring', () => {
    const source = readFileSync(resolve(__dirname, 'Attendance.tsx'), 'utf8');

    expect(source).toContain('reportApi.employeeInsights({ start_date: startDate, end_date: endDate, user_id: monitoringUserId })');
    expect(source).not.toContain('user_id: monitoringUserId, dashboard_lite: 1');
    expect(source).not.toContain('Screenshot Panel');
    expect(source).not.toContain('screenshotApi.getAll');
  });

  it('hydrates admin attendance filters from scoped dashboard links', () => {
    const source = readFileSync(resolve(__dirname, 'Attendance.tsx'), 'utf8');

    expect(source).toContain("const nextUserId = params.get('user') || params.get('user_id');");
    expect(source).toContain('setSelectedFilterUserId(resolvedUserId);');
    expect(source).toContain("setCalendarScope(resolvedUserId === '' ? 'overall' : 'selected');");
  });
});
