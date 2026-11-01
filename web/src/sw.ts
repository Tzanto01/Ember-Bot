/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { handleNotificationClick, handlePush } from './sw-handlers';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api(\/|$)/, /^\/health(\/|$)/, /^\/test(\/|$)/, /\/[^/?]+\.[^/?]+$/, /__/],
  }),
);

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event.data, self.registration));
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(handleNotificationClick(event.notification, self.clients, self.location.origin));
});
