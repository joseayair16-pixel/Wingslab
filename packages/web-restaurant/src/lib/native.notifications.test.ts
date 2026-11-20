import {
  readNativeFcmToken,
  persistNativeFcmToken,
  clearNativeFcmToken,
  cancelDeliveredNativeNotifications,
  onNativePushReceived,
} from './native';

describe('Restaurant Native FCM & Notification Cleanup', () => {
  let storage: Record<string, string> = {};

  beforeEach(() => {
    storage = {};
    const mockLocalStorage = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, val: string) => {
        storage[key] = val;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        storage = {};
      },
    };

    Object.defineProperty(global, 'window', {
      value: { localStorage: mockLocalStorage },
      writable: true,
      configurable: true,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete (global as any).window;
    delete (global as any).Capacitor;
  });

  it('guarda, lee y limpia el token FCM local del dispositivo', () => {
    expect(readNativeFcmToken()).toBeNull();

    persistNativeFcmToken('fcm-token-rest-123');
    expect(readNativeFcmToken()).toBe('fcm-token-rest-123');

    clearNativeFcmToken();
    expect(readNativeFcmToken()).toBeNull();
  });

  it('cancelDeliveredNativeNotifications no lanza error si el plugin no está presente', () => {
    expect(() => cancelDeliveredNativeNotifications()).not.toThrow();
  });

  it('cancelDeliveredNativeNotifications llama a removeAllDeliveredNotifications si el plugin existe', () => {
    const removeMock = jest.fn().mockResolvedValue(undefined);
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      isPluginAvailable: (name: string) => name === 'PushNotifications',
      Plugins: {
        PushNotifications: {
          removeAllDeliveredNotifications: removeMock,
        },
      },
    };

    cancelDeliveredNativeNotifications();
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it('reenvía al cliente eventos FCM recibidos con la app en primer plano y limpia listener', () => {
    let receive: ((message: any) => void) | undefined;
    const remove = jest.fn();
    (window as any).Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        PushNotifications: {
          addListener: jest.fn((name: string, callback: (message: any) => void) => {
            expect(name).toBe('pushNotificationReceived');
            receive = callback;
            return { remove };
          }),
        },
      },
    };
    const handler = jest.fn();
    const cleanup = onNativePushReceived(handler);

    receive?.({ data: { orderId: 'order-1' }, title: 'Nuevo pedido' });

    expect(handler).toHaveBeenCalledWith({ data: { orderId: 'order-1' }, title: 'Nuevo pedido', body: undefined });
    cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
