self.addEventListener('push', function (event) {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || 'Nueva Asignación';
  const options = {
    body: data.body || 'Tienes una nueva orden asignada.',
    icon: data.icon || '/SaDeL.png',
    badge: data.badge || '/SaDeL.png',
    vibrate: data.vibrate || [500, 100, 500, 100, 500],
    sound: data.sound || undefined,
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    data: data.data || {},
    tag: data.tag || 'driver-order-tag',
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch(function () {
      if (options.icon) delete options.icon;
      if (options.badge) delete options.badge;
      return self.registration.showNotification(title, options).catch(function () {});
    })
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url ? notifData.url : '/';
  const urlToOpen = new URL(targetUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      let matchingClient = null;

      for (let i = 0; i < windowClients.length; i++) {
        const windowClient = windowClients[i];
        if (windowClient.url.startsWith(self.location.origin)) {
          matchingClient = windowClient;
          break;
        }
      }

      if (matchingClient) {
        matchingClient.postMessage({
          type: 'NOTIFICATION_CLICK',
          orderId: notifData.orderId,
          url: notifData.url,
        });
        if ('navigate' in matchingClient && matchingClient.url !== urlToOpen) {
          try {
            matchingClient.navigate(urlToOpen);
          } catch (e) {
            // navigate puede fallar (iOS); postMessage ya fue enviado
          }
        }
        return matchingClient.focus();
      } else {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

const CACHE_NAME = 'sadel-driver-v1';
const PRECACHE_URLS = [
  '/sounds/notifica.wav',
  '/sounds/mensaje.wav',
  '/icon.svg',
  '/sadel-icon.svg',
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_URLS);
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(clients.claim());
});

// Escuchar mensajes desde la página para cachear o mostrar notificaciones de respaldo
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const options = {
      body: event.data.body || 'Tienes una nueva orden asignada.',
      icon: '/SaDeL.png',
      badge: '/SaDeL.png',
      vibrate: [500, 100, 500, 100, 500],
      tag: 'driver-order-tag',
      silent: false,
      requireInteraction: true,
      data: event.data.data || {},
    };
    self.registration.showNotification(event.data.title || 'Nueva Asignación', options);
  }
});

// Cache-first para notifica.wav
self.addEventListener('fetch', function(event) {
  if (event.request.url.includes('/sounds/notifica.wav')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request);
      })
    );
  }
});
