import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Settings > Profile must load personal details through a route the signed-in
 * user is actually allowed to call.
 *
 * It used to use `employeeWorkspaceApi.getWorkspace(currentUserId)` —
 * /employees/{id}/workspace, which is gated on `role:admin,manager`. An employee
 * was stopped by the middleware; a manager passed it and then failed the scope
 * check, because their own hierarchy level is not BELOW their own. Only an admin
 * ever received data.
 *
 * The 403 was swallowed by a bare `catch {}`, so the failure presented as an
 * empty form — indistinguishable from somebody who has filled nothing in. That
 * is why this is a source-level assertion: no rendering test would have caught
 * it either, since a blank form is exactly what it looked like.
 */
describe('settings personal-details load', () => {
  const source = readFileSync(join(__dirname, 'useSettingsController.ts'), 'utf8');

  it('reads the self-service route, not the admin workspace one', () => {
    expect(source).toContain('myEmployeeRecordApi.getRecords()');
  });

  it('never loads personal details through the admin-gated workspace route', () => {
    expect(
      source.includes('employeeWorkspaceApi.getWorkspace('),
      'getWorkspace is gated on role:admin,manager, so every non-admin gets 403 '
        + 'and Settings > Profile shows a blank form.',
    ).toBe(false);
  });

  it('reports a failed load instead of swallowing it', () => {
    // A silent catch here is what turned a 403 into "this person has entered
    // nothing", which nobody could tell apart.
    expect(source).toContain("reportSilentError('settings.personalDetails.load'");
    expect(source).not.toMatch(/}\s*catch\s*{\s*\/\/ Keep existing form data/);
  });
});
