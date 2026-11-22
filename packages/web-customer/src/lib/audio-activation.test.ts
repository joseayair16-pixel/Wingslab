import { warmup } from '../../../shared/src/audio';

test('does not create or resume AudioContext without transient user activation', async () => {
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const context = jest.fn();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext: context } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userActivation: { isActive: false } } });
  try {
    expect(await warmup()).toBe(false);
    expect(context).not.toHaveBeenCalled();
  } finally {
    if (windowBefore) Object.defineProperty(globalThis, 'window', windowBefore);
    else Reflect.deleteProperty(globalThis, 'window');
    if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
});
