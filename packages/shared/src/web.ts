export type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiRequestErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'forbidden'
  | 'validation'
  | 'business'
  | 'server'
  | 'unknown';

export class ApiRequestError extends Error {
  code?: string;
  status?: number;
  kind: ApiRequestErrorKind;
  isTransient: boolean;

  constructor(params: {
    message: string;
    kind: ApiRequestErrorKind;
    code?: string;
    status?: number;
    isTransient?: boolean;
  }) {
    super(params.message);
    this.name = 'ApiRequestError';
    this.code = params.code;
    this.status = params.status;
    this.kind = params.kind;
    this.isTransient = params.isTransient ?? false;
  }
}

export type AuthUser = {
  id: string;
  name: string;
  phone: string;
  role: 'ADMIN' | 'RESTAURANT' | 'CUSTOMER' | 'DRIVER';
  region: string;
  status: string;
  profilePhoto?: string | null;
  dateOfBirth?: string;
  createdAt?: string;
};

export type SendCodeResponse = {
  success: true;
  data: {
    phone: string;
    expiresInSeconds: number;
    mockCode?: string;
  };
};

export type AuthResponse = {
  success: true;
  data: {
    token: string;
    refreshToken?: string;
    user: AuthUser;
  };
};

export type UploadAssetKind =
  | 'restaurant-logo'
  | 'restaurant-cover'
  | 'product-image'
  | 'payment-proof'
  | 'site-image';

export type UploadAssetResponse = {
  success: true;
  data: {
    url: string;
    publicId: string;
    format?: string;
    width?: number;
    height?: number;
    bytes?: number;
    provider: 'r2';
    deliveryType: 'upload' | 'authenticated';
  };
};

export function getApiErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null) {
    // Handle standard API errors
    if ('error' in payload && typeof (payload as any).error?.message === 'string') {
      return (payload as any).error.message;
    }
    // Handle direct ZodError
    if ('issues' in payload && Array.isArray((payload as any).issues) && (payload as any).issues.length > 0) {
      return (payload as any).issues[0].message;
    }
    // Handle wrapped ZodError
    if ('error' in payload && typeof (payload as any).error === 'object' && 'issues' in (payload as any).error && Array.isArray((payload as any).error.issues) && (payload as any).error.issues.length > 0) {
      return (payload as any).error.issues[0].message;
    }
  }

  return fallback;
}

function getApiErrorCode(payload: unknown): string | undefined {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'error' in payload &&
    typeof (payload as { error?: { code?: unknown } }).error?.code === 'string'
  ) {
    return (payload as { error: { code: string } }).error.code;
  }

  return undefined;
}

function classifyResponseError(status: number): {
  kind: ApiRequestErrorKind;
  isTransient: boolean;
} {
  if (status === 401) {
    return { kind: 'auth', isTransient: false };
  }

  if (status === 403) {
    return { kind: 'forbidden', isTransient: false };
  }

  if (status === 400 || status === 404 || status === 422) {
    return { kind: 'validation', isTransient: false };
  }

  if (status >= 409 && status < 500) {
    return { kind: 'business', isTransient: false };
  }

  if (status >= 500) {
    return { kind: 'server', isTransient: true };
  }

  return { kind: 'unknown', isTransient: false };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isTransientRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && error.isTransient;
}

export function isAuthRequestError(error: unknown): error is ApiRequestError {
  return error instanceof ApiRequestError && (error.kind === 'auth' || error.kind === 'forbidden');
}

// Global hook so any authenticated request can force the app to log out when
// the server rejects the session (e.g. the user was deleted from the DB).
let sessionExpiredHandler: (() => void) | null = null;

export function setGlobalSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler;
}

// Disparador público para casos fuera del pipeline de requestJson
// (ej. socket.io rechazado por token expirado/inválido).
export function forceSessionExpired(): void {
  notifySessionExpired();
}

function notifySessionExpired(): void {
  try {
    sessionExpiredHandler?.();
  } catch (error) {
    console.error('Error en manejador global de sesión expirada:', error);
  }
}

export type PublishedAppVersion = {
  versionName: string;
  versionCode: number;
  url: string;
  changelog?: string;
  required?: boolean;
};

/**
 * Consulta la versión publicada del APK de una app (comensal, restaurante…).
 * `path` es la ruta del endpoint que la sirve (`/app/version` por defecto).
 * Devuelve `null` si no hay release publicado o falla la petición.
 */
export async function fetchPublishedAppVersion(
  apiBase: string,
  path = '/app/version',
): Promise<PublishedAppVersion | null> {
  try {
    const res = await fetch(`${apiBase}${path}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { success: boolean; data: any };
    const d = json?.data;
    if (!d || !d.url || !Number.isFinite(d.versionCode)) return null;
    return {
      versionName: String(d.versionName ?? ''),
      versionCode: d.versionCode,
      url: String(d.url),
      changelog: d.changelog ? String(d.changelog) : undefined,
      required: typeof d.required === 'boolean' ? d.required : undefined,
    };
  } catch {
    return null;
  }
}

export function getRequestErrorMessage(
  error: unknown,
  fallback = 'No se pudo completar la solicitud.'
): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return fallback;
}

export function readStoredSession(storageKey: string): {
  apiBase: string | null;
  token: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
} {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { apiBase: null, token: null, refreshToken: null, user: null };
    }
    const apiBase = window.localStorage.getItem(`${storageKey}.apiBase`);
    const token = window.localStorage.getItem(`${storageKey}.token`);
    const refreshToken = window.localStorage.getItem(`${storageKey}.refreshToken`);
    const serializedUser = window.localStorage.getItem(`${storageKey}.user`);

    return {
      apiBase,
      token,
      refreshToken,
      user: serializedUser ? (JSON.parse(serializedUser) as AuthUser) : null,
    };
  } catch (error) {
    console.error('Error reading stored session from localStorage:', error);
    return { apiBase: null, token: null, refreshToken: null, user: null };
  }
}

export function persistStoredSession(params: {
  storageKey: string;
  apiBase: string;
  token: string;
  refreshToken?: string;
  user: AuthUser;
}): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`${params.storageKey}.apiBase`, params.apiBase);
      window.localStorage.setItem(`${params.storageKey}.token`, params.token);
      if (params.refreshToken) {
        window.localStorage.setItem(`${params.storageKey}.refreshToken`, params.refreshToken);
      }
      window.localStorage.setItem(`${params.storageKey}.user`, JSON.stringify(params.user));
    }
  } catch (error) {
    console.error('Error writing session to localStorage:', error);
  }
}

export function persistApiBase(storageKey: string, apiBase: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`${storageKey}.apiBase`, apiBase);
    }
  } catch (error) {
    console.error('Error writing apiBase to localStorage:', error);
  }
}

export function clearStoredSession(storageKey: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(`${storageKey}.token`);
      window.localStorage.removeItem(`${storageKey}.refreshToken`);
      window.localStorage.removeItem(`${storageKey}.user`);
    }
  } catch (error) {
    console.error('Error clearing session from localStorage:', error);
  }
}

const requestCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 30_000;

function getCacheKey(apiBase: string, path: string): string {
  return `${apiBase}${path}`;
}

export type RefreshConfig = {
  refreshToken: string | (() => string | null | undefined);
  onRefreshed: (accessToken: string, newRefreshToken: string) => void;
  onRefreshFailed: () => void;
};

// Optional app-wide default used when an individual call doesn't supply its own
// refreshConfig (e.g. the customer app wires this once at startup so every
// requestJson call can transparently recover from an expired access token).
let defaultRefreshConfig: RefreshConfig | null = null;

export function setDefaultRefreshConfig(config: RefreshConfig | null): void {
  defaultRefreshConfig = config;
}

function resolveRefreshToken(config: RefreshConfig): string | null | undefined {
  return typeof config.refreshToken === 'function' ? config.refreshToken() : config.refreshToken;
}

type RefreshOutcome =
  | { ok: true; token: string; refreshToken: string }
  | { ok: false; definitive: boolean };

// Vuelos de refresh en curso, claveados por destino + token. Todas las
// peticiones que reciben 401 al mismo tiempo comparten UNA sola rotación en
// el backend: sin esto, cada una rota por su cuenta, la primera revoca el
// token de las demás y esas terminan deslogueando al usuario aunque todo
// fuera válido (carrera clásica de refresh).
const inflightRefreshes = new Map<string, Promise<RefreshOutcome>>();

/**
 * Renueva el access token con reintento ante fallos transitorios (red,
 * timeout, 5xx, 429). Solo un rechazo definitivo del servidor (4xx o
 * respuesta inválida con 200) marca `definitive: true`, que es el ÚNICO caso
 * en que la app debe cerrar la sesión. Un fallo transitorio persistente se
 * reporta como no-definitivo para que la sesión se conserve y la UI reintente.
 */
export async function refreshAccessToken(
  apiBase: string,
  refreshToken: string,
  timeoutMs: number,
): Promise<RefreshOutcome> {
  const key = `${apiBase}::${refreshToken}`;
  const existing = inflightRefreshes.get(key);
  if (existing) return existing;

  const task = (async (): Promise<RefreshOutcome> => {
    const maxAttempts = 3;
    for (let i = 0; i < maxAttempts; i += 1) {
      let res: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
        try {
          res = await fetch(`${apiBase}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // Red caída o timeout: reintentar con backoff, nunca desloguear por esto.
        if (i < maxAttempts - 1) {
          await wait(400 * (i + 1));
          continue;
        }
        return { ok: false, definitive: false };
      }

      if (res.status === 429 || res.status >= 500) {
        if (i < maxAttempts - 1) {
          await wait(500 * (i + 1));
          continue;
        }
        return { ok: false, definitive: false };
      }

      let payload: { success?: boolean; data?: { token?: string; refreshToken?: string } } | null = null;
      try {
        payload = (await res.json()) as { success?: boolean; data?: { token?: string; refreshToken?: string } };
      } catch {
        payload = null;
      }

      if (res.ok && payload?.success && payload.data?.token) {
        return { ok: true, token: payload.data.token, refreshToken: payload.data.refreshToken || refreshToken };
      }
      // 4xx o 200 inválido: el servidor rechazó el refresh de forma definitiva.
      return { ok: false, definitive: true };
    }
    return { ok: false, definitive: false };
  })();

  inflightRefreshes.set(key, task);
  try {
    return await task;
  } finally {
    inflightRefreshes.delete(key);
  }
}

export async function requestJson<T>(params: {
  apiBase: string;
  path: string;
  token?: string;
  options?: RequestInit;
  fallbackMessage?: string;
  timeoutMs?: number;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
  refreshConfig?: RefreshConfig;
}): Promise<T> {
  const attempts = Math.max(0, params.retry?.attempts ?? 2);
  const backoffMs = Math.max(0, params.retry?.backoffMs || 350);
  const timeoutMs = Math.max(0, params.timeoutMs ?? 15_000);
  let lastError: unknown;
  const hasBody = params.options?.body !== undefined;
  const useRequestCache = !hasBody && params.options?.cache === 'force-cache';
  const cacheKey = useRequestCache ? getCacheKey(params.apiBase, params.path) : '';
  let currentToken = params.token;
  // Se activa cuando el refresh se intentó pero falló por causa transitoria
  // (red/timeout/5xx): en ese caso NO se debe cerrar la sesión, solo reportar
  // un error reintentable para que la UI reintente sin desloguear.
  let refreshTransientFailure = false;

  if (cacheKey) {
    const entry = requestCache.get(cacheKey);
    if (entry && Date.now() - entry.ts < CACHE_TTL) {
      return entry.data as T;
    }
  }

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(`${params.apiBase}${params.path}`, {
          ...params.options,
          headers: {
            ...(hasBody ? { 'content-type': 'application/json' } : {}),
            ...(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
            ...(params.options?.headers || {}),
          },
          cache: params.options?.cache ?? 'no-store',
          ...(params.options?.signal ? {} : { signal: controller.signal }),
        });
      } finally {
        clearTimeout(timer);
      }

      const refreshConfig = params.refreshConfig ?? defaultRefreshConfig;
      if (!response.ok && response.status === 401 && refreshConfig && attempt === 0) {
        const storedRefreshToken = resolveRefreshToken(refreshConfig);
        if (!storedRefreshToken) {
          refreshConfig.onRefreshFailed();
        } else {
          const outcome = await refreshAccessToken(params.apiBase, storedRefreshToken, timeoutMs);
          if (outcome.ok) {
            refreshConfig.onRefreshed(outcome.token, outcome.refreshToken);
            currentToken = outcome.token;
            continue;
          }
          if (outcome.definitive) {
            refreshConfig.onRefreshFailed();
          } else {
            refreshTransientFailure = true;
          }
        }
      }

      const rawBody = await response.text();
      const payload = rawBody ? (JSON.parse(rawBody) as T | ApiErrorResponse) : null;

      if (!response.ok) {
        if (response.status === 401 && !refreshTransientFailure) {
          // Session no longer valid (e.g. user deleted): notify the app to log out.
          notifySessionExpired();
        }
        const fallback = params.fallbackMessage || 'No se pudo completar la solicitud.';
        if (response.status === 401 && refreshTransientFailure) {
          throw new ApiRequestError({
            message: 'Error de conexión. Intenta de nuevo.',
            status: response.status,
            kind: 'network',
            isTransient: true,
          });
        }
        const classification = classifyResponseError(response.status);

        throw new ApiRequestError({
          message: getApiErrorMessage(payload, fallback),
          code: getApiErrorCode(payload),
          status: response.status,
          kind: classification.kind,
          isTransient: classification.isTransient,
        });
      }

      // A 2xx can still carry a logical failure (success:false). Treat it as an
      // error so callers don't silently treat a failed request as success.
      if (payload && (payload as { success?: boolean }).success === false) {
        const fallback = params.fallbackMessage || 'No se pudo completar la solicitud.';
        const classification = classifyResponseError(response.status);
        throw new ApiRequestError({
          message: getApiErrorMessage(payload, fallback),
          code: getApiErrorCode(payload),
          status: response.status,
          kind: classification.kind,
          isTransient: classification.isTransient,
        });
      }

      if (cacheKey) {
        requestCache.set(cacheKey, { data: payload, ts: Date.now() });
        if (requestCache.size > 100) {
          const cutoff = Date.now() - CACHE_TTL * 2;
          for (const [k, v] of requestCache) {
            if (v.ts < cutoff) requestCache.delete(k);
          }
        }
      }
      return payload as T;
    } catch (error) {
      if (error instanceof SyntaxError) {
        lastError = new ApiRequestError({
          message: params.fallbackMessage || 'La respuesta del servidor no se pudo interpretar.',
          kind: 'server',
          isTransient: true,
        });
      } else if (error instanceof ApiRequestError) {
        lastError = error;
      } else if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new ApiRequestError({
          message: 'La solicitud excedio el tiempo esperado.',
          kind: 'timeout',
          isTransient: true,
        });
      } else {
        lastError = new ApiRequestError({
          message: params.fallbackMessage || 'No se pudo conectar con el servidor.',
          kind: 'network',
          isTransient: true,
        });
      }

      if (!isTransientRequestError(lastError) || attempt === attempts) {
        throw lastError;
      }

      await wait(backoffMs * (attempt + 1));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new ApiRequestError({
        message: params.fallbackMessage || 'No se pudo completar la solicitud.',
        kind: 'unknown',
      });
}

export type SubmitReviewPayload = {
  rating: number;
  comment?: string;
  driverRating?: number;
  driverComment?: string;
};

export type SubmitReviewResult = {
  ok: boolean;
  message?: string;
};

export async function submitReview(params: {
  apiBase: string;
  storageKey: string;
  orderId: string;
  payload: SubmitReviewPayload;
  getUser?: () => AuthUser | null;
  onTokenRefreshed?: (token: string, refreshToken?: string) => void;
  onSessionExpired?: () => void;
  timeoutMs?: number;
}): Promise<SubmitReviewResult> {
  const timeoutMs = Math.max(0, params.timeoutMs ?? 15_000);
  const session = readStoredSession(params.storageKey);
  const initialToken = session.token;
  const refreshToken = session.refreshToken;

  if (!initialToken) {
    params.onSessionExpired?.();
    return { ok: false, message: 'Tu sesión ha expirado. Inicia sesión de nuevo.' };
  }

  const doSubmit = (currentToken: string): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(`${params.apiBase}/customer/pedidos/${params.orderId}/review`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentToken}`,
      },
      body: JSON.stringify(params.payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
  };

  const isTransientHttpStatus = (status: number) => status >= 500 || status === 0;

  let response: Response | null = null;
  let lastSubmitError = false;

  try {
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      const res = await doSubmit(initialToken);
      if (attempt < 2 && isTransientHttpStatus(res.status)) {
        await wait(400 * (attempt + 1));
        continue;
      }
      response = res;
      break;
    }
  } catch {
    lastSubmitError = true;
  }

  if (lastSubmitError || !response) {
    return { ok: false, message: 'Error de conexión. Intenta de nuevo.' };
  }

  // Igual que en requestJson: un refresh que falla por causa transitoria no
  // debe cerrar la sesión; solo un rechazo definitivo lo justifica.
  let refreshTransientFailure = false;

  if (response.status === 401 && refreshToken) {
    const outcome = await refreshAccessToken(params.apiBase, refreshToken, timeoutMs);
    if (outcome.ok) {
      const newToken = outcome.token;
      const newRefreshToken = outcome.refreshToken;
      const user = params.getUser?.() || session.user;
      if (user) {
        persistStoredSession({
          storageKey: params.storageKey,
          apiBase: params.apiBase,
          token: newToken,
          refreshToken: newRefreshToken,
          user,
        });
      }
      params.onTokenRefreshed?.(newToken, newRefreshToken);
      response = await doSubmit(newToken);
    } else if (!outcome.definitive) {
      // Fallo transitorio (red/timeout/5xx): no desloguear; el 401 original se
      // reporta abajo como error reintentable.
      refreshTransientFailure = true;
    }
  }

  let body: { success?: boolean; error?: { code?: string; message?: string } } | null = null;
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') {
      body = parsed as { success?: boolean; error?: { code?: string; message?: string } };
    }
  } catch {
    // Non-JSON body — fall back to generic message
  }

  if (response.ok && body?.success !== false) {
    return { ok: true };
  }

  // Idempotencia: si la reseña ya existe (409), el pedido ya fue calificado con éxito.
  if (response.status === 409 && body?.error?.code === 'REVIEW_ALREADY_EXISTS') {
    return { ok: true };
  }

  if (response.status === 401) {
    if (!refreshTransientFailure) {
      params.onSessionExpired?.();
      return { ok: false, message: 'Tu sesión ha expirado. Inicia sesión de nuevo.' };
    }
    return { ok: false, message: 'No se pudo guardar tu calificación. Intenta de nuevo.' };
  }

  return {
    ok: false,
    message: body?.error?.message || 'No se pudo guardar tu calificación. Intenta de nuevo.',
  };
}

export function convertImageFileToDataUrl(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality: number,
  maxBytes?: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    (async () => {
      try {
        const isHeic = /\.heic$/i.test(file.name) || /^image\/heic/i.test(file.type);
        const isHeif = /\.heif$/i.test(file.name) || /^image\/heif/i.test(file.type);

        let blobToProcess: Blob = file;

        if (isHeic || isHeif) {
          const heic2anyModule = await import('heic2any');
          const converted = await heic2anyModule.default({
            blob: file,
            toType: 'image/jpeg',
            quality,
          });
          blobToProcess = Array.isArray(converted) ? converted[0] : converted;
        }

        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Could not get canvas context')); return; }
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (maxBytes && dataUrl.length > maxBytes) {
              reject(new Error(`La imagen comprimida excede el límite de ${Math.round(maxBytes / 1024 / 1024 * 10) / 10}MB. Intenta con una imagen más pequeña.`));
              return;
            }
            resolve(dataUrl);
          };
          img.onerror = () => reject(new Error('No se pudo cargar la imagen.'));
          img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        reader.readAsDataURL(blobToProcess);
      } catch (e) {
        reject(e instanceof Error ? e : new Error('Error al procesar la imagen.'));
      }
    })();
  });
}

export async function uploadMediaAsset(params: {
  apiBase: string;
  token: string;
  kind: UploadAssetKind;
  source: string;
  fileName?: string;
  fallbackMessage?: string;
  fallbackToSource?: boolean;
}): Promise<{
  url: string;
  publicId: string;
  provider: 'r2' | 'inline';
  deliveryType?: 'upload' | 'authenticated';
}> {
  try {
    const payload = await requestJson<UploadAssetResponse>({
      apiBase: params.apiBase,
      path: '/uploads/images',
      token: params.token,
      options: {
        method: 'POST',
        body: JSON.stringify({
          kind: params.kind,
          source: params.source,
          ...(params.fileName ? { fileName: params.fileName } : {}),
        }),
      },
      fallbackMessage: params.fallbackMessage || 'No se pudo subir la imagen.',
      timeoutMs: 60_000,
      retry: {
        attempts: 1,
        backoffMs: 400,
      },
    });

    return {
      url: payload.data.url,
      publicId: payload.data.publicId,
      provider: payload.data.provider,
      deliveryType: payload.data.deliveryType,
    };
  } catch (error) {
    if (
      params.fallbackToSource &&
      params.source.startsWith('data:') &&
      error instanceof ApiRequestError &&
      error.code === 'MEDIA_PROVIDER_NOT_CONFIGURED'
    ) {
      return {
        url: params.source,
        publicId: '',
        provider: 'inline',
      };
    }

    throw error;
  }
}
