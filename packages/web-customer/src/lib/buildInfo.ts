/**
 * Identificador del bundle web en ejecución.
 *
 * Sirve para comprobar en el propio dispositivo si corre el código con las
 * últimas correcciones: la navegación cliente (home ↔ restaurante) no recarga
 * el bundle, así que una app tibia puede seguir ejecutando código anterior al
 * despliegue aunque la red ya sirva el nuevo. Sin este sello, un reporte de
 * "sigue saliendo" es indistinguible entre regresión real y bundle viejo.
 *
 * Vercel inyecta NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA en cada build sin
 * configuración adicional; fuera de Vercel se usa NEXT_PUBLIC_SADEL_BUILD_ID.
 */
export const WEB_BUILD_ID: string = (() => {
  try {
    const sha =
      process?.env?.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_SADEL_BUILD_ID || '';
    return sha ? sha.slice(0, 12) : 'local-dev';
  } catch {
    return 'local-dev';
  }
})();

let buildLogged = false;

/** Registra el build una sola vez por carga del bundle (sin efectos visuales). */
export function logWebBuildOnce(): void {
  if (buildLogged) return;
  buildLogged = true;
  try {
    (window as any).__SADEL_WEB_BUILD = WEB_BUILD_ID;
  } catch {
    /* noop */
  }
  try {
    // eslint-disable-next-line no-console
    console.info(`[SaDeL] web build ${WEB_BUILD_ID}`);
  } catch {
    /* noop */
  }
}
