import { safeReturnUrl } from './lib/return-url';

/** Title shown when a push payload is missing or malformed: a push must always show a notification. */
export const fallbackTitle = 'Ember';

/** The body of the notification shown after "Done" logged the check-in; names no habit. */
export const loggedBody = 'Logged. Nice work. ✅';

/** A notification button; the DOM typings no longer declare `NotificationOptions.actions`. */
interface Action {
  action: string;
  title: string;
}

interface PushPayload {
  notification?: { title?: unknown; body?: unknown; actions?: unknown; data?: unknown } | null;
}

/**
 * Shows the notification for a push. Reads the bot's payload (contract v1.3, web push; v1.9 "Done")
 * `{"notification":{"title","body","actions"?,"data":{"onActionClick":{"default":{"operation","url"}},"doneToken"?}}}`,
 * passes `data` through for the click and shows the well-formed `actions`. Always shows one, with the title "Ember" when
 * the payload is missing or malformed.
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
  const actions = Array.isArray(notification?.actions)
    ? notification.actions.filter(
        (a): a is Action => typeof a?.action === 'string' && typeof a?.title === 'string',
      )
    : [];
  if (actions.length) (options as NotificationOptions & { actions: Action[] }).actions = actions;
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

/**
 * Handles the "Done" action: closes the notification and posts its one-time `doneToken` to `/api/reminders/done`
 * without cookies. On success shows a short confirmation; without a token, or when the request fails, it opens the
 * app like a click ({@link handleNotificationClick}).
 */
export async function handleDoneAction(
  notification: Pick<Notification, 'close' | 'data'>,
  registration: Pick<ServiceWorkerRegistration, 'showNotification'>,
  clients: Pick<Clients, 'matchAll' | 'openWindow'>,
  origin: string,
  post: typeof fetch = fetch,
): Promise<void> {
  notification.close();
  const token = (notification.data as { doneToken?: unknown } | null | undefined)?.doneToken;
  if (typeof token === 'string' && token) {
    const response = await post('/api/reminders/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'omit',
    }).catch(() => null);
    if (response?.ok) {
      await registration.showNotification(fallbackTitle, { body: loggedBody });
      return;
    }
  }
  await handleNotificationClick(notification, clients, origin);
}

/** Handles a page's message: `{ type: 'SKIP_WAITING' }` (sent by the update prompt's Reload) activates this worker. */
export function handleMessage(data: unknown, worker: Pick<ServiceWorkerGlobalScope, 'skipWaiting'>): Promise<void> {
  return (data as { type?: unknown } | null)?.type === 'SKIP_WAITING' ? worker.skipWaiting() : Promise.resolve();
}
