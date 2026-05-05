import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationsCenter from '@/pages/NotificationsCenter';
import { renderWithProviders } from '@/test/renderWithProviders';

const authState = vi.hoisted(() => ({
  value: {
    user: {
      id: 2,
      name: 'Employee',
      email: 'employee@example.com',
      role: 'employee',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
  },
}));

const apiMocks = vi.hoisted(() => ({
  notificationList: vi.fn(),
  markAllRead: vi.fn().mockResolvedValue({}),
  markRead: vi.fn().mockResolvedValue({}),
  publish: vi.fn().mockResolvedValue({}),
  userGetAll: vi.fn().mockResolvedValue({ data: [] }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');

  return {
    ...actual,
    notificationApi: {
      list: apiMocks.notificationList,
      markAllRead: apiMocks.markAllRead,
      markRead: apiMocks.markRead,
      publish: apiMocks.publish,
    },
    userApi: {
      getAll: apiMocks.userGetAll,
    },
  };
});

describe('NotificationsCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.notificationList.mockResolvedValue({
      data: {
        unread_count: 2,
        data: [
          {
            id: 301,
            title: 'New message from Example',
            message: 'hello',
            type: 'message',
            meta: { route: '/chat?threadType=direct&threadId=1' },
            is_read: false,
            created_at: '2026-05-01T05:00:00.000Z',
          },
          {
            id: 302,
            title: 'Half Day Leave Request Rejected',
            message: 'Your half day leave request was rejected.',
            type: 'leave_request',
            is_read: false,
            created_at: '2026-04-28T05:00:00.000Z',
          },
        ],
      },
    });
  });

  it('hides chat messages from the full notifications center', async () => {
    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    expect(await screen.findByText('Half Day Leave Request Rejected')).toBeInTheDocument();
    expect(screen.queryByText('New message from Example')).not.toBeInTheDocument();
    expect(apiMocks.notificationList).toHaveBeenCalledWith({
      limit: 100,
      type: undefined,
      exclude_types: ['chat_direct_message', 'chat_group_message', 'chat_message', 'direct_message', 'group_message'],
      unread_only: undefined,
    });
  });
});
