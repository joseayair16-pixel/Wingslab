const CACHE_NAME = 'sadel-customer-v10';

// App shell mínimo para que la PWA instalada abra aunque no haya red
// (la navegación sigue siendo network-first; esto solo garantiza un arranque offline).
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/app-icon-192.png',
  '/app-icon-512.png',
  '/SaDeL.png',
  '/badge.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.allSettled(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    })
  );
  self.skipWaiting();
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
      })
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
          if (options.icon) {
            delete options.icon;
          }
          if (options.badge) {
            delete options.badge;
          }
          return self.registration.showNotification(title, options).catch(function () {});
        });
      })
      .catch(function () {
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
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
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

// Cuando el navegador rota/expira la suscripción push (ocurre a veces en iOS/Android),
// avisamos a la app para que se vuelva a suscribir con un endpoint nuevo.
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

self.addEventListener('fetch', function (event) {
  var requestUrl = new URL(event.request.url);

  if (event.request.method !== 'GET' || !requestUrl.protocol.startsWith('http')) return;
  if (requestUrl.pathname.includes('socket.io')) return;

  // API reads (same-origin /api/... proxied by Next): network-first, no stale cache.
  // NUNCA se sirve una respuesta vieja si hay red: el estado del pedido debe ser
  // siempre el real. La caché solo respalda cuando no hay conexión (offline).
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(function (networkResponse) {
          if (networkResponse && networkResponse.ok) {
            var responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(function () {
          return caches.match(event.request).then(function (cached) {
            return cached || new Response(JSON.stringify({ success: false, data: null }), {
              status: 503,
              headers: { 'content-type': 'application/json' },
            });
          });
        })
    );
    return;
  }

  // Navigation (HTML pages): network-first, fallback to cache
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

  // JavaScript and CSS: network-first, no image fallback
  if (requestUrl.pathname.match(/\.(js|css)(\?.*)?$/)) {
    event.respondWith(
      fetch(event.request).then(function (networkResponse) {
        if (networkResponse && networkResponse.ok) {
          var responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(function () {
        return caches.match(event.request);
      })
    );
    return;
  }

  // Images and static assets: cache-first, fallback to network then nothing
  if (requestUrl.pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot)(\?.*)?$/)) {
    event.respondWith(
      caches.match(event.request).then(function (cachedResponse) {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then(function (networkResponse) {
          if (networkResponse && networkResponse.ok && networkResponse.status !== 206) {
            var responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        });
      })
    );
  }
});
