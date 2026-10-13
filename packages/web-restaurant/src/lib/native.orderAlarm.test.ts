// Pruebas de la decisión "¿la alarma nativa está sonando?" que gobierna si el
// audio web del aviso de pedido nuevo se calla o se mantiene como alternativa.
//
// Se verifica el contrato completo:
//   - navegador/PWA  -> false inmediato, sin esperas (comportamiento intacto)
//   - nativa sonando -> true (la web se calla, sin pitido duplicado)
//   - nativa callada / ausente / fallando -> false (la web sigue avisando)

type FakePlugin = { isRinging: jest.Mock };

function setCapacitor(options: {
  native?: boolean;
  plugin?: FakePlugin | null;
  isPluginAvailable?: boolean;
}): void {
  const plugins: Record<string, unknown> = {};
  if (options.plugin) plugins.OrderAlarm = options.plugin;
  (globalThis as any).window = {
    Capacitor: {
      isNativePlatform: () => options.native ?? false,
      Plugins: plugins,
      // Capacitor 8 ya no expone registerPlugin: el adaptador debe funcionar
      // sin él (fue la causa del fallo original).
      isPluginAvailable: (name: string) =>
        options.isPluginAvailable === true && name === 'OrderAlarm',
    },
  };
}

describe('isNativeOrderAlarmRinging', () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
    jest.restoreAllMocks();
  });

  it('devuelve false de inmediato en navegador/PWA, sin esperar el margen de gracia', async () => {
    setCapacitor({ native: false, plugin: null });
    const inicio = Date.now();
    const { isNativeOrderAlarmRinging } = await import('./native');
    const ringing = await isNativeOrderAlarmRinging();
    // El margen de gracia por defecto es 1200 ms: si se aplicara en web, esta
    // aserción fallaría.
    expect(ringing).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(100);
  });

  it('devuelve true cuando el plugin confirma que la alarma nativa está sonando', async () => {
    const plugin: FakePlugin = { isRinging: jest.fn().mockResolvedValue({ ringing: true }) };
    setCapacitor({ native: true, plugin });
    const { isNativeOrderAlarmRinging } = await import('./native');
    await expect(isNativeOrderAlarmRinging()).resolves.toBe(true);
    expect(plugin.isRinging).toHaveBeenCalledTimes(1);
  });

  it('no aplica margen de gracia si la alarma ya está sonando', async () => {
    const plugin: FakePlugin = { isRinging: jest.fn().mockResolvedValue({ ringing: true }) };
    setCapacitor({ native: true, plugin });
    const { isNativeOrderAlarmRinging } = await import('./native');
    const inicio = Date.now();
    await expect(isNativeOrderAlarmRinging()).resolves.toBe(true);
    expect(Date.now() - inicio).toBeLessThan(100);
    expect(plugin.isRinging).toHaveBeenCalledTimes(1);
  });

  it('reintenta tras el margen de gracia cuando la alarma arranca tarde (socket antes que push)', async () => {
    const plugin: FakePlugin = {
      isRinging: jest
        .fn()
        .mockResolvedValueOnce({ ringing: false })
        .mockResolvedValueOnce({ ringing: true }),
    };
    setCapacitor({ native: true, plugin });
    const { isNativeOrderAlarmRinging } = await import('./native');
    await expect(isNativeOrderAlarmRinging({ graceMs: 10 })).resolves.toBe(true);
    expect(plugin.isRinging).toHaveBeenCalledTimes(2);
  });

  it('devuelve false (alternativa web) si la alarma nativa sigue callada tras la gracia', async () => {
    const plugin: FakePlugin = { isRinging: jest.fn().mockResolvedValue({ ringing: false }) };
    setCapacitor({ native: true, plugin });
    const { isNativeOrderAlarmRinging } = await import('./native');
    await expect(isNativeOrderAlarmRinging({ graceMs: 5 })).resolves.toBe(false);
  });

  it('devuelve false (alternativa web) si el plugin no está en la APK', async () => {
    setCapacitor({ native: true, plugin: null });
    const { isNativeOrderAlarmRinging } = await import('./native');
    await expect(isNativeOrderAlarmRinging({ graceMs: 0 })).resolves.toBe(false);
  });

  it('devuelve false (alternativa web) si la consulta al nativo lanza', async () => {
    const plugin: FakePlugin = { isRinging: jest.fn().mockRejectedValue(new Error('boom')) };
    setCapacitor({ native: true, plugin });
    const { isNativeOrderAlarmRinging } = await import('./native');
    await expect(isNativeOrderAlarmRinging({ graceMs: 0 })).resolves.toBe(false);
  });

  it('devuelve false (alternativa web) si el plugin no expone isRinging', async () => {
    setCapacitor({ native: true, plugin: {} as unknown as FakePlugin });
    const { isNativeOrderAlarmRinging } = await import('./native');
    await expect(isNativeOrderAlarmRinging({ graceMs: 0 })).resolves.toBe(false);
  });
});

describe('hasNativeOrderAlarm', () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it('es true cuando el nativo publica el plugin OrderAlarm', async () => {
    setCapacitor({ native: true, isPluginAvailable: true });
    const { hasNativeOrderAlarm } = await import('./native');
    expect(hasNativeOrderAlarm()).toBe(true);
  });

  it('es false en navegador', async () => {
    setCapacitor({ native: false, isPluginAvailable: true });
    const { hasNativeOrderAlarm } = await import('./native');
    expect(hasNativeOrderAlarm()).toBe(false);
  });
});
