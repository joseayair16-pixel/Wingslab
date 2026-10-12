/**
 * Contrato de mensajes FCM entre el backend y las APKs (evidencia A).
 *
 * Estos builders determinan QUÉ ve Android en cada caso:
 *  - `buildFcmMessage`: mensaje normal con bloque `notification` → lo muestra
 *    el sistema aunque la app esté cerrada, usando `android.notification.channelId`.
 *  - `buildRingDataMessage`: data-only (`type: order-ring-start`) → Android NO
 *    muestra nada por sí solo; solo tiene sentido en APKs que implementan
 *    `SaDelMessagingService` + `OrderAlarmService` (restaurante/repartidor).
 *  - `isRingPayload` + `isRingCapableAppVersion`: deciden cuál de los dos se
 *    envía a cada token.
 */
import {
  buildFcmMessage,
  buildRingDataMessage,
  isRingCapableAppVersion,
  isRingPayload,
  mapSoundToChannelId,
  RING_MIN_APP_VERSION,
} from './fcm.service';

const base = {
  title: 'Pedido listo',
  body: 'Pasa a recogerlo.',
  icon: '/app-icon-192.png',
  badge: '/badge.png',
};

describe('mapSoundToChannelId — el canal nativo correcto con su .wav', () => {
  it('mapea cada sonido web a su channelId registrado en los APKs', () => {
    expect(mapSoundToChannelId('/sounds/notifica.wav')).toBe('notifica');
    expect(mapSoundToChannelId('/sounds/llegue.wav')).toBe('llegue');
    expect(mapSoundToChannelId('/sounds/rezagado.wav')).toBe('rezagado');
    expect(mapSoundToChannelId('/sounds/mensaje.wav')).toBe('mensaje');
  });

  it('devuelve undefined sin sonido (el llamador usa el canal default)', () => {
    expect(mapSoundToChannelId(undefined)).toBeUndefined();
  });
});

describe('isRingPayload — solo la alarma viaja como data-only', () => {
  it('true con el flag explícito', () => {
    expect(isRingPayload({ ...base, nativeRing: true })).toBe(true);
  });

  it('false con el flag explícito aunque el tag parezca de alarma', () => {
    expect(isRingPayload({ ...base, nativeRing: false, tag: 'new-order-1' })).toBe(false);
  });

  it('detecta los tags de alarma por convención', () => {
    expect(isRingPayload({ ...base, tag: 'new-order-abc' })).toBe(true);
    expect(isRingPayload({ ...base, tag: 'order-assigned-abc' })).toBe(true);
  });

  it('los avisos de estado del cliente NO son alarma', () => {
    for (const tag of [
      'order-ready-1',
      'driver-arrived-1',
      'pickup-reminder-1',
      'order-chat-1',
      'overdue-customer-1',
    ]) {
      expect(isRingPayload({ ...base, tag })).toBe(false);
    }
  });
});

describe('isRingCapableAppVersion — versionCode mínimo del APK', () => {
  it(`acepta versionCode >= ${RING_MIN_APP_VERSION}`, () => {
    expect(isRingCapableAppVersion(RING_MIN_APP_VERSION)).toBe(true);
    expect(isRingCapableAppVersion(RING_MIN_APP_VERSION + 5)).toBe(true);
  });

  it('rechaza versiones viejas o ausentes (reciben el mensaje normal)', () => {
    expect(isRingCapableAppVersion(1)).toBe(false);
    expect(isRingCapableAppVersion(0)).toBe(false);
    expect(isRingCapableAppVersion(null)).toBe(false);
    expect(isRingCapableAppVersion(undefined)).toBe(false);
    expect(isRingCapableAppVersion(NaN)).toBe(false);
  });
});

describe('buildFcmMessage — lo que Android muestra solo', () => {
  it('lleva title/body y el channelId del sonido en alta prioridad', () => {
    const msg: any = buildFcmMessage({ ...base, sound: '/sounds/llegue.wav' });
    expect(msg.notification).toEqual({ title: 'Pedido listo', body: 'Pasa a recogerlo.' });
    expect(msg.android.priority).toBe('high');
    expect(msg.android.notification.channelId).toBe('llegue');
    expect(msg.data.click_action).toBe('OPEN_ORDER');
  });

  it('infiere el canal desde el evento cuando no hay sound explícito', () => {
    const chat: any = buildFcmMessage({ ...base, data: { type: 'new_chat_message' } });
    expect(chat.android.notification.channelId).toBe('mensaje');
    const ready: any = buildFcmMessage({ ...base, data: { event: 'order:ready' } });
    expect(ready.android.notification.channelId).toBe('llegue');
  });

  it('usa el canal default y sticky=true por defecto', () => {
    const msg: any = buildFcmMessage({ ...base });
    expect(msg.android.notification.channelId).toBe('default');
    expect(msg.android.notification.sticky).toBe(true);
  });

  it('respeta vibrate y requireInteraction=false', () => {
    const msg: any = buildFcmMessage({ ...base, vibrate: [300, 100, 300], requireInteraction: false });
    expect(msg.android.notification.vibrateTimingsMillis).toEqual([300, 100, 300]);
    expect(msg.android.notification.sticky).toBe(false);
  });
});

describe('buildRingDataMessage — data-only: el sistema NO muestra nada', () => {
  it('no tiene bloque notification (Android no lo presenta solo)', () => {
    const msg: any = buildRingDataMessage({
      ...base,
      sound: '/sounds/notifica.wav',
      nativeRingExpiresAt: 123,
      data: { orderId: 'o1' },
    });
    expect(msg.notification).toBeUndefined();
    expect(msg.android.priority).toBe('high');
    expect(msg.data.type).toBe('order-ring-start');
    expect(msg.data.title).toBe('Pedido listo');
    expect(msg.data.body).toBe('Pasa a recogerlo.');
    expect(msg.data.sound).toBe('notifica');
    expect(msg.data.expiresAt).toBe('123');
    expect(msg.data.click_action).toBe('OPEN_ORDER');
  });

  it('usa notifica.wav ante la falta de sonido y expiresAt=0 sin ventana', () => {
    const msg: any = buildRingDataMessage({ ...base });
    expect(msg.data.sound).toBe('notifica');
    expect(msg.data.expiresAt).toBe('0');
  });
});
