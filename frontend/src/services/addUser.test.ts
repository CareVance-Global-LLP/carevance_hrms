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
