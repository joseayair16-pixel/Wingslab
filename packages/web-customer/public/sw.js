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
    icon: data.icon || '/SaDeL.png',
    badge: data.badge || '/SaDeL.png',
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
      if (options.icon) {
        delete options.icon;
      }
      if (options.badge) {
        delete options.badge;
      }
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

const CACHE_NAME = 'sadel-static-assets-v3';
const STATIC_ASSETS = [
  '/SaDeL.png',
  '/app-icon-192.png',
  '/manifest.json',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS).catch(function () {});
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

self.addEventListener('fetch', function (event) {
  var requestUrl = new URL(event.request.url);

  // Skip non-GET and non-http(s) requests
  if (event.request.method !== 'GET' || !requestUrl.protocol.startsWith('http')) return;

  // Skip API calls — always go to network
  if (requestUrl.pathname.startsWith('/api/')) return;

  // Skip socket.io
  if (requestUrl.pathname.includes('socket.io')) return;

  // Cache-first for static assets (JS, CSS, images, fonts)
  if (
    requestUrl.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot)(\?.*)?$/) ||
    requestUrl.origin === self.location.origin
  ) {
    event.respondWith(
      caches.match(event.request).then(function (cachedResponse) {
        if (cachedResponse) {
          // Fetch in background to update cache
          fetch(event.request).then(function (networkResponse) {
            if (networkResponse && networkResponse.ok && networkResponse.status !== 206) {
              caches.open(CACHE_NAME).then(function (cache) {
                cache.put(event.request, networkResponse);
              });
            }
          }).catch(function () {});
          return cachedResponse;
        }

        return fetch(event.request).then(function (networkResponse) {
          if (networkResponse && networkResponse.ok && networkResponse.status !== 206) {
            var responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(function () {
          return caches.match('/SaDeL.png');
        });
      })
    );
  }
});
