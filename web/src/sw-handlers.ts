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
  notification?: { title?: unknown; body?: unknown; actions?: unknown; data?: unknown; tag?: unknown } | null;
  clear?: { tag?: unknown } | null;
}

/**
 * Shows the notification for a push. Reads the bot's payload (contract v1.3, web push; v1.9 "Done"; v1.14 tag)
 * `{"notification":{"title","body","actions"?,"tag"?,"data":{"onActionClick":{"default":{"operation","url"}},"doneToken"?}}}`,
 * passes `data` through for the click, shows the well-formed `actions` and, with a `tag`, replaces the notification
 * under that tag and alerts again (`renotify`). Always shows one, with the title "Ember" when the payload is missing or
 * malformed. A v1.14 clear payload `{"clear":{"tag"}}` shows a silent "Logged" notification under that tag, then
 * closes every notification with it, so the reminder goes away and nothing stays.
 */
export async function handlePush(
  data: { json(): unknown } | null,
  registration: Pick<ServiceWorkerRegistration, 'showNotification' | 'getNotifications'>,
): Promise<void> {
  let payload: PushPayload | null = null;
  try {
    const parsed = data?.json() as PushPayload | null | undefined;
    if (parsed && typeof parsed === 'object') payload = parsed;
  } catch {
    payload = null;
  }
  const clearTag = typeof payload?.clear === 'object' ? payload.clear?.tag : undefined;
  if (typeof clearTag === 'string' && clearTag) {
    await registration.showNotification(fallbackTitle, { tag: clearTag, body: loggedBody, silent: true });
    for (const shown of await registration.getNotifications({ tag: clearTag })) shown.close();
    return;
  }
  const notification = typeof payload?.notification === 'object' ? payload.notification : null;
  const title = notification?.title;
  const body = notification?.body;
  const tag = notification?.tag;
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
  if (typeof tag === 'string' && tag) {
    options.tag = tag;
    (options as NotificationOptions & { renotify: boolean }).renotify = true;
  }
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
