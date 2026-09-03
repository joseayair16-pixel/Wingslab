// Almacena en IndexedDB un pequeño objeto con el token JWT y la VAPID public
// key, de modo que el service worker pueda RE-SUSCRIBIRSE por sí mismo cuando
// iOS/Android rota la suscripción push (pushsubscriptionchange), aunque no haya
// ninguna pestaña de la app abierta. IndexedDB es accesible tanto desde la ventana
// como desde el SW (localStorage no lo es para el SW).

const DB_NAME = 'sadel-subscription';
const STORE_NAME = 'secrets';
const KEY = 'push';

export type SubscriptionSecrets = {
  token: string;
  vapidKey: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Error abriendo IndexedDB'));
  });
}

export async function saveSubscriptionSecrets(secrets: SubscriptionSecrets): Promise<void> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(secrets, KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Error guardando secrets'));
      };
    });
  } catch {
    // Fallo de almacenamiento no debe romper la suscripción principal.
  }
}

export async function getSubscriptionSecrets(): Promise<SubscriptionSecrets | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as SubscriptionSecrets) || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error || new Error('Error leyendo secrets'));
      };
    });
  } catch {
    return null;
  }
}

export async function clearSubscriptionSecrets(): Promise<void> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Error limpiando secrets'));
      };
    });
  } catch {
    // Noop
  }
}
