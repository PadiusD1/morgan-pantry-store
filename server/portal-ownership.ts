import { and, desc, eq, inArray } from 'drizzle-orm';
import { notifications, requests } from '@shared/schema';
import { db } from './pg';

/** Only a persisted account association establishes portal ownership. */
export function ownsPortalRequest(userId: string, request: { userId?: string | null }): boolean {
  return !!userId && request.userId === userId;
}

export async function accountNotifications(userId: string) {
  const rows = await db.select({ notification: notifications }).from(notifications)
    .innerJoin(requests, eq(notifications.requestId, requests.id))
    .where(and(eq(requests.userId, userId), eq(notifications.recipientType, 'client')))
    .orderBy(desc(notifications.createdAt));
  return rows.map(row => row.notification);
}

/** Authorization stays in the write, not just in an earlier read. */
export async function markAccountNotificationsRead(userId: string, notificationId?: string) {
  return db.update(notifications).set({ read: true }).where(and(
    eq(notifications.recipientType, 'client'),
    inArray(notifications.requestId, db.select({ id: requests.id }).from(requests).where(eq(requests.userId, userId))),
    notificationId ? eq(notifications.id, notificationId) : undefined,
  )).returning({ id: notifications.id });
}
