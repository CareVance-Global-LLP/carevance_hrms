import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  deliveryStats: vi.fn().mockResolvedValue({ data: { data: [] } }),
  getPollResults: vi.fn().mockResolvedValue({ data: { data: [], total_votes: 0, is_multiple_choice: false, has_expired: false } }),
  votePoll: vi.fn().mockResolvedValue({}),
  userGetAll: vi.fn().mockResolvedValue({ data: [] }),
  groupGetAll: vi.fn().mockResolvedValue({ data: { data: [] } }),
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
      deliveryStats: apiMocks.deliveryStats,
      getPollResults: apiMocks.getPollResults,
      votePoll: apiMocks.votePoll,
    },
    userApi: { getAll: apiMocks.userGetAll },
    groupApi: { getAll: apiMocks.groupGetAll },
  };
});

const asAdmin = () => {
  authState.value = {
    user: {
      id: 1,
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
  };
};

const asEmployee = () => {
  authState.value = {
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
  };
};

describe('NotificationsCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asEmployee();
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

  it('hides chat messages from the announcements feed', async () => {
    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    expect(await screen.findByText('Half Day Leave Request Rejected')).toBeInTheDocument();
    expect(screen.queryByText('New message from Example')).not.toBeInTheDocument();
    expect(apiMocks.notificationList).toHaveBeenCalledWith({
      // LIST_PAGE_SIZE. The feed loads a screenful at a time and grows by the
      // same amount on "load more", rather than opening with 30 rows the reader
      // has to scroll past to reach the controls.
      limit: 15,
      type: undefined,
      exclude_types: ['chat_direct_message', 'chat_group_message', 'chat_message', 'direct_message', 'group_message'],
      unread_only: undefined,
    });
  });

  it('shows a poll question and its standings instead of a blank card', async () => {
    apiMocks.notificationList.mockResolvedValue({
      data: {
        unread_count: 0,
        data: [
          {
            // Polls are published with an empty title, so the card used to
            // render an empty heading and hide the message too.
            id: 401,
            title: '',
            message: '',
            type: 'poll',
            is_read: true,
            created_at: '2026-05-01T05:00:00.000Z',
            poll: {
              id: 9,
              app_notification_id: 401,
              question: 'Which week works for the offsite?',
              expires_at: null,
              is_multiple_choice: false,
              options: [
                { id: 1, poll_id: 9, option_text: 'Week of 15 Sep', vote_count: 6 },
                { id: 2, poll_id: 9, option_text: 'Week of 22 Sep', vote_count: 4 },
              ],
            },
          },
        ],
      },
    });

    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    expect(await screen.findByRole('heading', { name: 'Which week works for the offsite?' })).toBeInTheDocument();
    expect(screen.getByText('Week of 15 Sep')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText(/10 votes/)).toBeInTheDocument();
  });

  it('surfaces the priority that was previously stored and never shown', async () => {
    apiMocks.notificationList.mockResolvedValue({
      data: {
        unread_count: 0,
        data: [
          {
            id: 501,
            title: 'Office closed Monday',
            message: 'Building maintenance.',
            type: 'announcement',
            meta: { priority: 'urgent' },
            is_read: true,
            created_at: '2026-05-01T05:00:00.000Z',
          },
        ],
      },
    });

    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    expect(await screen.findByText('Office closed Monday')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
  });

  it('keeps composing behind a button instead of always on screen', async () => {
    const user = userEvent.setup();
    asAdmin();

    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    await screen.findByText('Half Day Leave Request Rejected');
    expect(screen.queryByRole('dialog', { name: 'New announcement' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /New announcement/ }));
    expect(await screen.findByRole('dialog', { name: 'New announcement' })).toBeInTheDocument();
  });

  it('filters recipients by search text inside the compose drawer', async () => {
    const user = userEvent.setup();
    asAdmin();
    apiMocks.userGetAll.mockResolvedValue({
      data: [
        { id: 11, name: 'Dhwani Patel', email: 'dhwani@example.com' },
        { id: 12, name: 'Mit Gujarati', email: 'mit@example.com' },
      ],
    });

    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    await screen.findByText('Half Day Leave Request Rejected');
    await user.click(screen.getByRole('button', { name: /New announcement/ }));

    const drawer = await screen.findByRole('dialog', { name: 'New announcement' });
    // Both are listed up front — the old picker refused to show anyone until
    // you chose a department or typed a search.
    expect(within(drawer).getByText('Dhwani Patel')).toBeInTheDocument();

    await user.type(within(drawer).getByLabelText('Search recipients'), 'mit');

    expect(within(drawer).getByText('Mit Gujarati')).toBeInTheDocument();
    expect(within(drawer).queryByText('Dhwani Patel')).not.toBeInTheDocument();
  });

  it('keeps every character typed into the compose drawer', async () => {
    const user = userEvent.setup();
    asAdmin();

    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    await screen.findByText('Half Day Leave Request Rejected');
    await user.click(screen.getByRole('button', { name: /New announcement/ }));

    const drawer = await screen.findByRole('dialog', { name: 'New announcement' });
    await user.type(within(drawer).getByLabelText('Title'), 'Office closed Monday');

    // The drawer's focus effect depended on its `onClose` prop, which callers
    // pass as an inline arrow — so every keystroke re-ran it and yanked focus
    // out of the field. Only the first character survived.
    expect(within(drawer).getByLabelText('Title')).toHaveValue('Office closed Monday');
  });

  it('disables publish while the request is in flight', async () => {
    const user = userEvent.setup();
    asAdmin();
    let release: (() => void) | undefined;
    apiMocks.publish.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        })
    );

    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    await screen.findByText('Half Day Leave Request Rejected');
    await user.click(screen.getByRole('button', { name: /New announcement/ }));

    const drawer = await screen.findByRole('dialog', { name: 'New announcement' });
    await user.type(within(drawer).getByLabelText('Title'), 'Office closed');
    await user.type(within(drawer).getByLabelText('Message'), 'Maintenance on Monday.');

    const publishButton = within(drawer).getByRole('button', { name: 'Publish' });
    await user.click(publishButton);

    // A second click used to fire a second publish, sending to everyone twice.
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Publishing...' })).toBeDisabled());
    expect(apiMocks.publish).toHaveBeenCalledTimes(1);

    release?.();
  });

  it('counts unread across everything, not just the filtered view', async () => {
    const user = userEvent.setup();
    renderWithProviders(<NotificationsCenter />, { route: '/notifications' });

    await screen.findByText('Half Day Leave Request Rejected');
    expect(screen.getByText('2')).toBeInTheDocument();

    // Searching narrows the feed but must not change the unread total.
    await user.type(screen.getByLabelText('Search announcements'), 'half day');

    await waitFor(() => expect(screen.queryByText('New message from Example')).not.toBeInTheDocument());
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
