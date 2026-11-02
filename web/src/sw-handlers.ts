import { safeReturnUrl } from './lib/return-url';

/** Title shown when a push payload is missing or malformed: a push must always show a notification. */
export const fallbackTitle = 'Ember';

interface PushPayload {
  notification?: { title?: unknown; body?: unknown; data?: unknown } | null;
}

/**
 * Shows the notification for a push. Reads the bot's payload (contract v1.3, web push)
 * `{"notification":{"title","body","data":{"onActionClick":{"default":{"operation","url"}}}}}` and passes `data`
 * through for the click. Always shows one, with the title "Ember" when the payload is missing or malformed.
 */
export function handlePush(
  data: { json(): unknown } | null,
  registration: Pick<ServiceWorkerRegistration, 'showNotification'>,
): Promise<void> {
  let notification: PushPayload['notification'] = null;
  try {
    const payload = data?.json() as PushPayload | null | undefined;
    if (payload && typeof payload.notification === 'object') notification = payload.notification;
  } catch {
    notification = null;
  }
  const title = notification?.title;
  const body = notification?.body;
  const options: NotificationOptions = {
    body: typeof body === 'string' && body ? body : 'A gentle nudge from Ember',
  };
  if (notification?.data !== undefined) options.data = notification.data;
  return registration.showNotification(
    typeof title === 'string' && title ? title : fallbackTitle,
    options,
  );
}

/** The click target: the payload's `onActionClick.default.url` when it is a same-origin relative path, else `/today`. */
export function clickTarget(data: unknown): string {
  const url = (data as { onActionClick?: { default?: { url?: unknown } } } | null | undefined)
    ?.onActionClick?.default?.url;
  return safeReturnUrl(typeof url === 'string' ? url : null);
}

/**
 * Handles a notification click: closes it, then focuses an open window of this origin (navigating it to the target
 * when it shows another page) or opens a new window on the target.
 */
export async function handleNotificationClick(
  notification: Pick<Notification, 'close' | 'data'>,
  clients: Pick<Clients, 'matchAll' | 'openWindow'>,
  origin: string,
): Promise<void> {
  notification.close();
  const target = clickTarget(notification.data);
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const client = windows.find((c) => new URL(c.url).origin === origin) as WindowClient | undefined;
  if (!client) {
    await clients.openWindow(target);
    return;
  }
  try {
    const focused = await client.focus();
    const shown = new URL(focused.url);
    if (shown.pathname + shown.search !== target) await focused.navigate(new URL(target, origin).href);
  } catch {
    await clients.openWindow(target);
  }
}
