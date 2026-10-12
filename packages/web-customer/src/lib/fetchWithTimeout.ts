/**
 * `fetch` con límite temporal para operaciones best-effort (p. ej. revocar
 * registros push al cerrar sesión).
 *
 * Al agotarse `timeoutMs` deja de esperar y rechaza con `AbortError`, igual
 * que un abort manual: el llamador lo trata como cualquier otro fallo de red
 * (sin reintentar y sin bloquear el flujo principal). El temporizador siempre
 * se limpia, haya éxito, fallo o abort.
 *
 * La espera usa una carrera y no un simple `await fetch(...)`: así ni siquiera
 * una implementación de `fetch` que ignore la señal de abort puede dejar
 * colgado al llamador. La petición subyacente puede seguir en segundo plano,
 * pero aquí ya no se la espera.
 *
 * Si el llamador ya trae su propia `signal`, se respeta: abortarla también
 * aborta esta petición.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 5000, signal: callerSignal, ...fetchInit } = init;
  const controller = new AbortController();

  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onTimeout = () =>
    new Promise<never>((_, reject) => {
      if (controller.signal.aborted) {
        reject(abortError());
        return;
      }
      controller.signal.addEventListener('abort', () => reject(abortError()), { once: true });
    });

  try {
    return await Promise.race([fetch(input, { ...fetchInit, signal: controller.signal }), onTimeout()]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

function abortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('Aborted', 'AbortError');
  }
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}
