// public/pages/appunti-sw.js — service worker of the class notes page: shows the push notifications
// (test reminders) and opens the right page when one is tapped. Scope: /pages/.
'use strict';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
    event.waitUntil(self.registration.showNotification(String(data.title || 'Appunti di classe'), {
        body: String(data.body || ''),
        icon: '../assets/appunti/icon-192.png',
        badge: '../assets/appunti/icon-192.png',
        tag: data.tag ? String(data.tag) : undefined,
        data: { url: String(data.url || '/pages/appunti.php') },
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    // Only pages of this site
    const target = new URL(event.notification.data && event.notification.data.url || '/pages/appunti.php', self.location.origin);
    const url = target.origin === self.location.origin ? target.href : new URL('/pages/appunti.php', self.location.origin).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
        for (const client of list) {
            if (client.url.startsWith(self.location.origin + '/pages/appunti.php') && 'focus' in client) {
                return client.navigate(url).then((c) => (c || client).focus());
            }
        }
        return self.clients.openWindow(url);
    }));
});
