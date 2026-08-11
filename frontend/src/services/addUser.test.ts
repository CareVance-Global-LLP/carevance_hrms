import { describe, expect, it, vi } from 'vitest';
import { addUserService } from '@/services/addUser';

describe('addUserService import parsing', () => {
  it('parses project invitation spreadsheets that use Mail and Access Level columns', () => {
    const parsed = addUserService.parseTableRows(
      [
        ['Mail', 'Access Level'],
        ['mavliirbaz.carevanceglobal@gmail.com', 'Employee'],
        ['aayushborwal.carevacneglobal@gmail.com', 'Manager'],
      ],
      [],
      []
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
        email: 'mavliirbaz.carevanceglobal@gmail.com',
        name: 'Mavliirbaz Carevanceglobal',
        role: 'employee',
        groupIds: [],
        projectIds: [],
    });
    expect(parsed.rows[1]).toMatchObject({
        email: 'aayushborwal.carevacneglobal@gmail.com',
        name: 'Aayushborwal Carevacneglobal',
        role: 'manager',
        groupIds: [],
        projectIds: [],
    });
  });

  it('treats job titles in a role column as employee imports', () => {
    const parsed = addUserService.parseTableRows(
      [
        ['email', 'name', 'role', 'groups', 'projects'],
        ['john.smith@test.com', 'John', 'Software Engineer', 'Engineering', 'Sarah Lee'],
        ['priya.patel@test.com', 'Priya', 'Marketing Manager', 'Marketing', 'David Kim'],
      ],
      [{ id: 5, name: 'Engineering', description: '' }],
      []
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      email: 'john.smith@test.com',
      name: 'John',
      role: 'employee',
      groupIds: [5],
      projectIds: [],
      skippedRoleLabel: 'Software Engineer',
    });
    expect(parsed.rows[1]).toMatchObject({
      email: 'priya.patel@test.com',
      name: 'Priya',
      role: 'employee',
      skippedRoleLabel: 'Marketing Manager',
    });
  });

  it('validates access_role when explicit access roles are provided', () => {
    const parsed = addUserService.parseTableRows(
      [
        ['email', 'name', 'role', 'access_role'],
        ['john.smith@test.com', 'John', 'Software Engineer', 'manager'],
        ['bad.role@test.com', 'Bad Role', 'Designer', 'Owner'],
      ],
      [],
      []
    );

    expect(parsed.errors).toEqual(['Row 3: unsupported access role "Owner". Use employee, manager, or admin.']);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      email: 'john.smith@test.com',
      role: 'manager',
    });
  });

  it('reads xlsx files without crashing when the library returns workbook sheet objects', async () => {
    vi.doMock('read-excel-file/browser', () => ({
      default: vi.fn(async () => [
        ['Mail', 'Access Level'],
        ['mavliirbaz.carevanceglobal@gmail.com', 'Employee'],
      ]),
    }));

    const file = new File(['placeholder'], 'project_invitation_access.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const parsed = await addUserService.parseImportFile(file, [], []);

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      email: 'mavliirbaz.carevanceglobal@gmail.com',
      role: 'employee',
    });

    vi.doUnmock('read-excel-file/browser');
  });

  it('matches import headers regardless of case spaces underscores or hyphens', () => {
    const parsed = addUserService.parseTableRows(
      [
        ['EMAIL_ADDRESS', 'role_Role', 'GROUP-IDS', 'Project IDs'],
        ['alex@example.com', 'MANAGER', '10', '20'],
      ],
      [],
      []
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      email: 'alex@example.com',
      role: 'manager',
      groupIds: [10],
      projectIds: [20],
    });
  });
});

describe('joining dates in an import', () => {
  it('reads a joining date column so onboarding can anchor on the real start date', () => {
    // Without one the checklist anchors on whenever the invite is accepted,
    // which puts every day -14 pre-boarding item in the past on arrival.
    const parsed = addUserService.parseTableRows(
      [
        ['email', 'joining_date'],
        ['starts.later@test.com', '2026-09-01'],
      ],
      [],
      []
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].joiningDate).toBe('2026-09-01');
  });

  it('accepts the common header spellings', () => {
    const parsed = addUserService.parseTableRows(
      [
        ['email', 'Date of Joining'],
        ['a@test.com', '2026-09-01'],
      ],
      [],
      []
    );

    expect(parsed.rows[0].joiningDate).toBe('2026-09-01');
  });

  it('reports the row rather than importing someone with an unreadable date', () => {
    const parsed = addUserService.parseTableRows(
      [
        ['email', 'joining_date'],
        ['good@test.com', '2026-09-01'],
        ['bad@test.com', 'next tuesday-ish'],
      ],
      [],
      []
    );

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].email).toBe('good@test.com');
    expect(parsed.errors[0]).toContain('Row 3');
    expect(parsed.errors[0]).toContain('joining date');
  });

  it('leaves the joining date unset when the column is absent', () => {
    const parsed = addUserService.parseTableRows([['email'], ['a@test.com']], [], []);

    expect(parsed.rows[0].joiningDate).toBeUndefined();
  });
});

describe('the downloadable template', () => {
  it('puts job titles in job_title and permissions in access_role', () => {
    // The old template demonstrated the confusing arrangement: a `role` column
    // holding "Software Engineer" with job_title left empty.
    const anchor = document.createElement('a');
    const clickSpy = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockReturnValueOnce(anchor);
    const blobSpy = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => undefined);

    addUserService.downloadCsvTemplate();

    const blob = blobSpy.mock.calls[0][0] as Blob;
    expect(clickSpy).toHaveBeenCalled();

    return blob.text().then((content) => {
      const [header, firstRow] = content.split('\n');
      expect(header).toContain('access_role');
      expect(header).toContain('job_title');
      expect(header).not.toMatch(/(^|,)role(,|$)/);
      expect(firstRow).toContain('Software Engineer');
      expect(header.split(',').indexOf('job_title'))
        .toBe(firstRow.split(',').findIndex((cell) => cell === 'Software Engineer'));
      vi.restoreAllMocks();
    });
  });
});
