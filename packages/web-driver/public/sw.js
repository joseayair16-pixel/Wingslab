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
    icon: data.icon || '/app-icon-192.png',
    badge: data.badge || '/badge.png',
    vibrate: data.vibrate || [500, 100, 500, 100, 500],
    sound: data.sound || undefined,
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    data: data.data || {},
    tag: data.tag || 'driver-order-tag',
  };

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clients) {
        // Si la app está visible en primer plano, la app ya reproduce el audio
        // (socket + Web Audio). Silenciar la notificación del sistema evita el
        // doble sonido/vibración. En segundo plano/cerrada sí suena el OS.
        const focused = clients.some(function (client) {
          return 'visibilityState' in client && client.visibilityState === 'visible';
        });
        if (focused) {
          options.silent = true;
          delete options.vibrate;
        }
        return self.registration.showNotification(title, options).catch(function () {
          if (options.icon) delete options.icon;
          if (options.badge) delete options.badge;
          return self.registration.showNotification(title, options).catch(function () {});
        });
      })
      .catch(function () {
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

const CACHE_NAME = 'sadel-driver-v4';
const PRECACHE_URLS = [
  '/',
  '/icon.svg',
  '/sadel-icon.svg',
  '/app-icon-192.png',
  '/app-icon-512.png',
  '/badge.png',
  '/manifest.json',
];

self.addEventListener('install', function(event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    })
  );
});

self.addEventListener('activate', function(event) {
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
      })
    ])
  );
});

// Escuchar mensajes desde la página para mostrar notificaciones de respaldo en background
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const orderId = event.data.data?.orderId || 'unknown';
    const options = {
      body: event.data.body || 'Tienes una nueva orden asignada.',
      icon: '/app-icon-192.png',
      badge: '/badge.png',
      vibrate: [500, 100, 500, 100, 500],
      tag: 'driver-assignment-' + orderId,
      silent: false,
      requireInteraction: true,
      data: event.data.data || {},
    };
    self.registration.showNotification(event.data.title || 'Nueva Asignación', options).catch(function () {});
  }
});

// Cache-first para todos los sonidos bajo /sounds/
self.addEventListener('fetch', function(event) {
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

  if (url.pathname.startsWith('/sounds/') && url.pathname.endsWith('.wav')) {
    event.respondWith(
      caches.match(event.request).then(function(cached) {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  // Assets estáticos de Next.js (JS/CSS con hash): cache-first con
  // revalidación en segundo plano. Solo se cachean respuestas exitosas.
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/_next/static/') || url.pathname === '/manifest.json')
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function(cache) {
        return cache.match(event.request).then(function(cached) {
          var fetchPromise = fetch(event.request).then(function(networkResponse) {
            if (networkResponse && networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(function() {
            return cached;
          });
          return cached || fetchPromise;
        });
      })
    );
    return;
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
