const CACHE_NAME = 'sadel-customer-v11';

// App shell mínimo para que la PWA instalada abra aunque no haya red
// (la navegación sigue siendo network-first; esto solo garantiza un arranque offline).
const PRECACHE_URLS = [
  '/',
  '/manifest.webmanifest',
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

// ---------- Re-suscripción push auto-gestionada por el SW ----------
// Cuando iOS/Android rota o expira la suscripción (pushsubscriptionchange), el SW
// se re-suscribe por sí mismo y notifica al backend, SIN depender de que haya una
// pestaña de la app abierta (si la hay, además avisa para sincronizar la UI).

function openSecretsDb() {
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open('sadel-subscription', 1);
    request.onupgradeneeded = function () {
      var db = request.result;
      if (!db.objectStoreNames.contains('secrets')) {
        db.createObjectStore('secrets');
      }
    };
    request.onsuccess = function () { resolve(request.result); };
    request.onerror = function () { reject(request.error); };
  });
}

function readSecrets() {
  return openSecretsDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction('secrets', 'readonly');
      var req = tx.objectStore('secrets').get('push');
      req.onsuccess = function () {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = function () {
        db.close();
        reject(req.error);
      };
    });
  }).catch(function () { return null; });
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  var outputArray = new Uint8Array(rawData.length);
  for (var i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function notifyOpenClients() {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
    return Promise.all(
      windowClients.map(function (client) {
        return client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      })
    );
  });
}

function serializeSubscription(subscription) {
  var keys = subscription.toJSON().keys;
  if (!keys) return null;
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

function reportSubscriptionToBackend(subscription, token, attempts) {
  var body = serializeSubscription(subscription);
  if (!body || !token) return Promise.resolve();
  attempts = attempts || 0;
  return fetch('/api/notifications/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    },
    body: JSON.stringify(body),
  }).catch(function () {
    // Reintenta con backoff si hay fallo transitorio de red; mantiene viva la
    // suscripción local aunque no se pueda reportar de inmediato.
    if (attempts < 4) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          reportSubscriptionToBackend(subscription, token, attempts + 1).then(resolve);
        }, 1000 * Math.pow(2, attempts));
      });
    }
  });
}

function resubscribeInServiceWorker(attempts) {
  attempts = attempts || 0;
  return readSecrets().then(function (secrets) {
    // Sin secrets no hay forma de re-suscribir ni reportar al backend estando
    // la app cerrada; avisa a las ventanas por si alguna puede hacerlo. La app
    // además re-sincroniza al volver (visibilitychange), que es la red de seguridad.
    if (!secrets || !secrets.token) {
      return notifyOpenClients();
    }
    var options = { userVisibleOnly: true };
    if (secrets.vapidKey) {
      options.applicationServerKey = urlBase64ToUint8Array(secrets.vapidKey);
    }
    return self.registration.pushManager.subscribe(options)
      .then(function (newSubscription) {
        return Promise.all([
          reportSubscriptionToBackend(newSubscription, secrets.token, 0),
          notifyOpenClients(),
        ]);
      })
      .catch(function (err) {
        // InvalidStateError: la sub vieja quedó huérfana y hay que limpiarla antes.
        if (err && err.name === 'InvalidStateError') {
          return self.registration.pushManager.getSubscription()
            .then(function (stale) {
              if (stale) { return stale.unsubscribe().catch(function () {}); }
            })
            .then(function () {
              notifyOpenClients();
            });
        }
        // Fallo transitorio: reintenta con backoff.
        if (attempts < 4) {
          return new Promise(function (resolve) {
            setTimeout(function () {
              resubscribeInServiceWorker(attempts + 1).then(resolve);
            }, 1000 * Math.pow(2, attempts));
          });
        }
        return notifyOpenClients();
      });
  });
}

self.addEventListener('pushsubscriptionchange', function (event) {
  event.waitUntil(resubscribeInServiceWorker(0));
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
