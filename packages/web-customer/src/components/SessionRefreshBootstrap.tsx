'use client';

import { forceSessionExpired, readStoredSession, setDefaultRefreshConfig } from '@sadel/shared';

const storageKey = 'sadel.customer';

// Se evalúa al importar el layout, antes de cualquier efecto de página: toda la
// app (incluida /cuenta abierta en frío) renueva el access token de forma
// transparente. Antes solo el storefront lo configuraba, así que una sesión
// vencida en /cuenta terminaba en logout en vez de refrescarse.
if (typeof window !== 'undefined') {
  setDefaultRefreshConfig({
    refreshToken: () => readStoredSession(storageKey).refreshToken,
    onRefreshed: (token, refreshToken) => {
      try {
        window.localStorage.setItem(`${storageKey}.token`, token);
        if (refreshToken) window.localStorage.setItem(`${storageKey}.refreshToken`, refreshToken);
      } catch {
        // Almacenamiento bloqueado: se sigue con el token en memoria.
      }
      // Las vistas montadas guardan el token en estado React, no solo en
      // localStorage; sin este evento seguirían usando el token viejo.
      window.dispatchEvent(new CustomEvent<string>('sadel:token-refreshed', { detail: token }));
    },
    onRefreshFailed: () => forceSessionExpired(),
  });
}

export default function SessionRefreshBootstrap() {
  return null;
}
