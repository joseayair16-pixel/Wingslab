const CACHE_NAME = 'sadel-restaurant-v3';
const PRECACHE_URLS = [
  '/',
  '/sounds/notifica.wav',
  '/sounds/mensaje.wav',
  '/sounds/rezagado.wav',
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

  const title = data.title || 'Nuevo Pedido';
  const options = {
    body: data.body || 'Tienes un nuevo pedido pendiente.',
    icon: data.icon || '/app-icon-192.png',
    badge: data.badge || '/badge.png',
    vibrate: data.vibrate || [500, 250, 500, 250, 500],
    sound: data.sound || undefined,
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    data: data.data || {},
    tag: data.tag || 'sadel-restaurant-order',
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

  const orderId = event.notification.data?.orderId || event.notification.data?.id || null;

  event.waitUntil((async () => {
    const action = event.notification.data?.action || 'open';
    if (orderId) {
      try {
        const db = await new Promise((resolve, reject) => {
          const req = self.indexedDB.open('sadel-push', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('pending', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('pending', 'readwrite');
        tx.objectStore('pending').put({ id: 'orderId', value: orderId, action });
        await new Promise(r => { tx.oncomplete = r; });
      } catch {}
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetClient = clients.find(c => c.url.startsWith(self.location.origin));

    if (targetClient) {
      await targetClient.focus();
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 600));
        try {
          targetClient.postMessage({ type: 'NOTIFICATION_CLICK', orderId, action });
          break;
        } catch {}
      }
    } else {
      await self.clients.openWindow(orderId ? `/?orderId=${orderId}` : '/');
    }
  })());
});

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
