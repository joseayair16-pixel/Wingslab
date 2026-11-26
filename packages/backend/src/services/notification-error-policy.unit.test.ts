import { isTransientError } from './notification.service';

describe('clasificación de errores de envío push', () => {
  it('considera transitorios solo errores de red y del servidor', () => {
    expect(isTransientError({ message: 'network request failed' })).toBe(true);
    expect(isTransientError({ message: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientError({ statusCode: 429 })).toBe(true);
    expect(isTransientError({ statusCode: 503 })).toBe(true);
  });

  it('no reintenta errores definitivos aunque el mensaje diga timeout', () => {
    expect(isTransientError({ statusCode: 400, message: 'request timeout' })).toBe(false);
    expect(isTransientError({ statusCode: 401, message: 'timeout' })).toBe(false);
    expect(isTransientError({ statusCode: 410 })).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});
