const CACHE_NAME = 'sadel-admin-v3';
const PRECACHE_URLS = [
  '/',
  '/sounds/notifica.wav',
  '/sounds/mensaje.wav',
  '/SaDeL.png',
  '/app-icon-192.png',
  '/app-icon-512.png',
  '/badge.png',
  '/manifest.json',
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.allSettled(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then(function (cacheNames) {
        return Promise.all(
          cacheNames.map(function (cacheName) {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }),
    ])
  );
});

self.addEventListener('push', function (event) {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }

  const title = data.title || 'Nueva notificación de SaDeL';
  const options = {
    body: data.body || 'Tienes un nuevo mensaje sobre tu pedido.',
    icon: data.icon || '/app-icon-192.png',
    badge: data.badge || '/badge.png',
    vibrate: data.vibrate || [500, 250, 500, 250, 500],
    sound: data.sound || undefined,
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    data: data.data || {},
  };

  if (data.tag) {
    options.tag = data.tag;
  }

  event.waitUntil(
    self.registration.showNotification(title, options).catch(function () {
      if (options.icon) delete options.icon;
      if (options.badge) delete options.badge;
      return self.registration.showNotification(title, options).catch(function () {});
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();

  const data = event.notification.data || {};
  const relativePath = data.url
    ? data.url
    : data.orderId
      ? `/?orderId=${data.orderId}`
      : '/';
  const urlToOpen = new URL(relativePath, self.location.origin).href;

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
          orderId: data.orderId,
          url: data.url,
        });
        if ('navigate' in matchingClient && matchingClient.url !== urlToOpen) {
          try {
            matchingClient.navigate(urlToOpen);
          } catch (e) {}
        }
        return matchingClient.focus();
      } else {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Navigation (HTML): network-first, fallback a la app shell cacheada
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(function (networkResponse) {
        return networkResponse;
      }).catch(function () {
        return caches.match(event.request).then(function (cached) {
          if (cached) return cached;
          return caches.match('/');
        });
      })
    );
    return;
  }

  if (url.pathname.startsWith('/sounds/')) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (response) {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, copy);
            });
          }
          return response;
        });
      })
    );
  }
});

// Cuando el navegador rota la suscripción push, avisamos a la app para re-suscribir
self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      return Promise.all(
        windowClients.map(function (client) {
          return client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
        })
      );
    })
  );
});
