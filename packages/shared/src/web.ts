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

export async function requestJson<T>(params: {
  apiBase: string;
  path: string;
  token?: string;
  options?: RequestInit;
  fallbackMessage?: string;
  retry?: {
    attempts?: number;
    backoffMs?: number;
  };
  refreshConfig?: {
    refreshToken: string;
    onRefreshed: (accessToken: string, newRefreshToken: string) => void;
    onRefreshFailed: () => void;
  };
}): Promise<T> {
  const attempts = Math.max(0, params.retry?.attempts ?? 2);
  const backoffMs = Math.max(0, params.retry?.backoffMs || 350);
  let lastError: unknown;
  const hasBody = params.options?.body !== undefined;
  let currentToken = params.token;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${params.apiBase}${params.path}`, {
        ...params.options,
        headers: {
          ...(hasBody ? { 'content-type': 'application/json' } : {}),
          ...(currentToken ? { authorization: `Bearer ${currentToken}` } : {}),
          ...(params.options?.headers || {}),
        },
        cache: 'no-store',
      });

      if (!response.ok && response.status === 401 && params.refreshConfig && attempt === 0) {
        try {
          const refreshRes = await fetch(`${params.apiBase}/auth/refresh`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ refreshToken: params.refreshConfig.refreshToken }),
          });

          if (refreshRes.ok) {
            const refreshPayload = await refreshRes.json();
            if (refreshPayload.success && refreshPayload.data) {
              params.refreshConfig.onRefreshed(
                refreshPayload.data.token,
                refreshPayload.data.refreshToken,
              );
              currentToken = refreshPayload.data.token;
              continue;
            }
          }
        } catch {
          // Refresh failed — fall through to original error
        }
        params.refreshConfig.onRefreshFailed();
      }

      const rawBody = await response.text();
      const payload = rawBody ? (JSON.parse(rawBody) as T | ApiErrorResponse) : null;

      if (!response.ok) {
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
