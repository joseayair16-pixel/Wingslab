/**
 * Tests para `waitForNativeBridge` (@sadel/shared).
 *
 * Nota: el import resuelve a `packages/shared/dist` (el build compilado).
 * Reconstruye el paquete compartido (`npm run build -w @sadel/shared`) antes
 * de correr estos tests si cambiaste el fuente.
 *
 * Contexto: las APKs de SaDeL cargan una URL remota (`server.url`) y en ese
 * modo Capacitor solo inyecta `window.Capacitor` si el WebView soporta
 * document-start scripts. El helper existe para no decidir "soy web" antes de
 * darle una oportunidad al bridge: si la app se suscribiera por web-push
 * dentro del APK, el token FCM nunca se registraría y Android no recibiría
 * nada.
 */
import { waitForNativeBridge } from '@sadel/shared';

describe('waitForNativeBridge', () => {
  it('resuelve true de inmediato si el bridge ya existe', async () => {
    await expect(waitForNativeBridge({ isReady: () => true })).resolves.toBe(true);
  });

  it('espera a que el bridge aparezca tarde y resuelve true', async () => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 50);
    await expect(
      waitForNativeBridge({ isReady: () => ready, timeoutMs: 1000, intervalMs: 10 })
    ).resolves.toBe(true);
  });

  it('resuelve false al agotar el tiempo cuando el bridge nunca aparece', async () => {
    const started = Date.now();
    await expect(
      waitForNativeBridge({ isReady: () => false, timeoutMs: 80, intervalMs: 10 })
    ).resolves.toBe(false);
    // No espera de más: el timeout se respeta.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('respeta el timeout personalizado', async () => {
    const started = Date.now();
    await waitForNativeBridge({ isReady: () => false, timeoutMs: 150, intervalMs: 20 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
  });

  it('detecta el bridge aunque `isReady` falle al principio', async () => {
    let calls = 0;
    const isReady = () => {
      calls += 1;
      return calls >= 3;
    };
    await expect(
      waitForNativeBridge({ isReady, timeoutMs: 1000, intervalMs: 10 })
    ).resolves.toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});
