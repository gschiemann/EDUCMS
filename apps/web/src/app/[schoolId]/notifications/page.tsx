"use client";

import { useRouter, useParams } from 'next/navigation';
import {
  useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
} from '@/hooks/use-api';
import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';
import type { InboxNotification } from '@/components/notifications/notificationInbox';

/**
 * M21 — Notifications. The route; the surface itself is
 * `components/notifications/NotificationsInbox.tsx`.
 *
 * Thin on purpose: this owns the three hooks, the tenant-scoping of a
 * notification's link, and nothing else. Keeping the view props-only is what
 * lets its four §13 states be photographed from a fixture on a production
 * build rather than described.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const params = useParams();
  const schoolId = String(params?.schoolId ?? '');

  const { data, isPending, isError, refetch, isFetching } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const open = (n: InboxNotification) => {
    if (!n.isRead) markRead.mutate(n.id);
    if (!n.link) return;
    // Relative app paths are tenant-scoped; anything absolute is left alone.
    router.push(n.link.startsWith('/') && schoolId ? `/${schoolId}${n.link}` : n.link);
  };

  return (
    <NotificationsInbox
      items={data?.items as InboxNotification[] | undefined}
      isPending={isPending}
      isError={isError}
      isFetching={isFetching}
      onOpen={open}
      onMarkAllRead={() => markAll.mutate()}
      onRetry={() => refetch()}
    />
  );
}
