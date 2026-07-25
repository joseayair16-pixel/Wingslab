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
    icon: data.icon || '/SaDeL.png',
    badge: data.badge || '/SaDeL.png',
    vibrate: data.vibrate || [500, 250, 500, 250, 500],
    sound: data.sound || undefined,
    requireInteraction: data.requireInteraction !== undefined ? data.requireInteraction : true,
    data: data.data || {},
    tag: data.tag || 'default',
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
    // Guardar en IndexedDB como respaldo por si postMessage se pierde
    if (orderId) {
      try {
        const db = await new Promise((resolve, reject) => {
          const req = self.indexedDB.open('sadel-push', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('pending', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('pending', 'readwrite');
        tx.objectStore('pending').put({ id: 'orderId', value: orderId });
        await new Promise(r => { tx.oncomplete = r; });
      } catch {}
    }

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const targetClient = clients.find(c => c.url.startsWith(self.location.origin));

    if (targetClient) {
      await targetClient.focus();
      // Intentar postMessage varias veces para cubrir el tiempo de hidratación
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 600));
        try {
          targetClient.postMessage({ type: 'NOTIFICATION_CLICK', orderId });
          break;
        } catch {}
      }
    } else {
      // Sin ventana existente: abrir con ?orderId en la URL (más fiable que postMessage)
      await self.clients.openWindow(orderId ? `/?orderId=${orderId}` : '/');
    }
  })());
});

self.addEventListener('install', function() {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});
