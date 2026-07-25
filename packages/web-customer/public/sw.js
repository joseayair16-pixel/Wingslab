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
      // Si showNotification falla (icono no disponible, etc.), reintentar sin icono
      if (options.icon) {
        delete options.icon;
      }
      if (options.badge) {
        delete options.badge;
      }
      return self.registration.showNotification(title, options).catch(function () {
        // Silenciar error si también falla sin icono
      });
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

const CACHE_NAME = 'sadel-static-assets-v2';

self.addEventListener('install', function (event) {
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
