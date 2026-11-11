/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { handleMessage, handleNotificationClick, handlePush } from './sw-handlers';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api(\/|$)/, /^\/health(\/|$)/, /^\/test(\/|$)/, /\/[^/?]+\.[^/?]+$/, /__/],
  }),
);

registerRoute(
  ({ request }) => request.destination === 'font',
  new CacheFirst({ cacheName: 'ember-fonts' }),
);

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(event.data, self.registration));
});

self.addEventListener('notificationclick', (event) => {
  event.waitUntil(handleNotificationClick(event.notification, self.clients, self.location.origin));
});

self.addEventListener('message', (event) => {
  event.waitUntil(handleMessage(event.data, self));
});
