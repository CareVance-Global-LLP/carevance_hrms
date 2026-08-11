import { describe, expect, it, vi, beforeEach } from 'vitest';
import { addUserService, EMAIL_BATCH_LIMIT } from '@/services/addUser';
import { invitationApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  invitationApi: { create: vi.fn() },
  projectApi: { getAll: vi.fn() },
  reportGroupApi: { list: vi.fn() },
}));

const createMock = vi.mocked(invitationApi.create);

const okResponse = (count: number) => ({
  status: 201,
  data: { success: true, invited_count: count, failed: [], invitations: [] },
});

const basePayload = {
  organizationId: 1,
  role: 'employee' as const,
  groupIds: [],
  projectIds: [],
  settings: {
    monitoringInterval: null,
    canEditTime: false,
    attendanceMonitoring: true,
    payrollVisibility: false,
    taskAssignmentAccess: true,
  },
};

beforeEach(() => {
  createMock.mockReset();
});

describe('inviteByEmail batching', () => {
  it('sends a single request when the list fits inside one batch', async () => {
    createMock.mockResolvedValue(okResponse(3) as any);

    const result = await addUserService.inviteByEmail({
      ...basePayload,
      emails: ['a@test.com', 'b@test.com', 'c@test.com'],
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.invitedCount).toBe(3);
  });

  it('splits a list larger than the API ceiling instead of failing on it', async () => {
    // The tag input accepted any number of addresses while the request refused
    // more than fifty, so a real hiring list was assembled and then rejected on
    // the count alone.
    const emails = Array.from({ length: 60 }, (_, index) => `bulk${index}@test.com`);
    createMock
      .mockResolvedValueOnce(okResponse(EMAIL_BATCH_LIMIT) as any)
      .mockResolvedValueOnce(okResponse(10) as any);

    const result = await addUserService.inviteByEmail({ ...basePayload, emails });

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0][0].emails).toHaveLength(EMAIL_BATCH_LIMIT);
    expect(createMock.mock.calls[1][0].emails).toHaveLength(10);
    expect(result.invitedCount).toBe(60);
  });

  it('accumulates per-recipient failures across batches', async () => {
    const emails = Array.from({ length: 60 }, (_, index) => `bulk${index}@test.com`);
    createMock
      .mockResolvedValueOnce({
        status: 201,
        data: { success: true, invited_count: 49, failed: [{ email: 'bulk0@test.com', message: 'Already a member.' }] },
      } as any)
      .mockResolvedValueOnce({
        status: 201,
        data: { success: true, invited_count: 9, failed: [{ email: 'bulk55@test.com', message: 'Already a member.' }] },
      } as any);

    const result = await addUserService.inviteByEmail({ ...basePayload, emails });

    expect(result.invitedCount).toBe(58);
    expect(result.failed).toHaveLength(2);
  });

  it('passes the joining date, job title and expiry through to the API', async () => {
    createMock.mockResolvedValue(okResponse(1) as any);

    await addUserService.inviteByEmail({
      ...basePayload,
      emails: ['a@test.com'],
      joiningDate: '2026-09-01',
      jobTitle: 'Support Analyst',
      expiresInHours: 168,
    });

    expect(createMock.mock.calls[0][0]).toMatchObject({
      joining_date: '2026-09-01',
      job_title: 'Support Analyst',
      expires_in_hours: 168,
    });
  });

  it('omits the optional fields entirely when they are not set', async () => {
    createMock.mockResolvedValue(okResponse(1) as any);

    await addUserService.inviteByEmail({ ...basePayload, emails: ['a@test.com'] });

    const sent = createMock.mock.calls[0][0];
    expect(sent).not.toHaveProperty('joining_date');
    expect(sent).not.toHaveProperty('job_title');
  });
});

describe('fetchGroups when react-query calls it unbound', () => {
  it('does not depend on `this`', async () => {
    // It is handed to useQuery as a bare reference, so `this` is undefined
    // inside it. A `this.x()` call there fails the query and the departments
    // list silently comes back empty — which then makes every CSV row fall
    // back to the default departments instead of the ones it named.
    const { reportGroupApi } = await import('@/services/api');
    vi.mocked(reportGroupApi.list).mockResolvedValue({
      data: { data: [{ id: 7, name: 'Engineering', users: [{ id: 1 }] }] },
    } as any);

    const detached = addUserService.fetchGroups;

    await expect(detached()).resolves.toEqual([
      { id: 7, name: 'Engineering', description: '1 member', isDefault: false },
    ]);
  });
});
