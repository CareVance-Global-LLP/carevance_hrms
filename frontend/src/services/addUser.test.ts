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
    expect(parsed.rows).toEqual([
      {
        email: 'mavliirbaz.carevanceglobal@gmail.com',
        name: 'Mavliirbaz Carevanceglobal',
        role: 'employee',
        groupIds: [],
        projectIds: [],
      },
      {
        email: 'aayushborwal.carevacneglobal@gmail.com',
        name: 'Aayushborwal Carevacneglobal',
        role: 'manager',
        groupIds: [],
        projectIds: [],
      },
    ]);
  });

  it('reads xlsx files without crashing when the library returns workbook sheet objects', async () => {
    vi.doMock('read-excel-file/browser', () => ({
      default: vi.fn(async () => [
        {
          sheet: 'Invitations',
          data: [
            ['Mail', 'Access Level'],
            ['mavliirbaz.carevanceglobal@gmail.com', 'Employee'],
          ],
        },
      ]),
      readSheet: undefined,
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
