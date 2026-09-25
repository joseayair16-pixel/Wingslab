/**
 * Generación de imágenes de producto con Cloudflare Workers AI (FLUX schnell).
 * El resultado se devuelve como Base64 de la imagen generada (JPEG); la
 * persistencia final usa el pipeline R2 existente (storage.service).
 *
 * Costo: FLUX schnell ≈ 172 neuronas/imagen (1024x1024, 4 pasos). El free tier
 * de Workers AI otorga 10k neuronas/día; por eso cada restaurante tiene un tope
 * diario configurable (AI_IMAGE_DAILY_CAP, default 25), contado en Redis.
 */

import { AppError } from '../errors/app-error';
import { getRedis } from '../config/redis';
import { logger } from '../utils/logger';

const MODEL = '@cf/black-forest-labs/flux-1-schnell';
const DEFAULT_DAILY_CAP = 25;
const REQUEST_TIMEOUT_MS = 60_000;
const PROMPT_MAX_LENGTH = 2048;

export function isAiImageConfigured(): boolean {
  return Boolean(process.env.CF_ACCOUNT_ID?.trim() && process.env.CF_API_TOKEN?.trim());
}

export function getAiImageDailyCap(): number {
  const raw = Number(process.env.AI_IMAGE_DAILY_CAP);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_DAILY_CAP;
}

function secondsUntilNextUtcDay(): number {
  const now = Date.now();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCHours(24, 0, 0, 0);
  return Math.max(Math.floor((nextMidnight.getTime() - now) / 1000), 1);
}

/** Incrementa el contador diario del restaurante; lanza 429 al exceder el tope. */
export async function assertAiImageQuota(restaurantId: string): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  const redis = getRedis();
  const key = `ai-image:daily:${restaurantId}`;
  const used = await redis.incr(key);
  if (used === 1) {
    await redis.expire(key, secondsUntilNextUtcDay());
  }

  const cap = getAiImageDailyCap();
  if (used > cap) {
    // No consumimos la cuota en el rechazo.
    await redis.decr(key);
    throw new AppError(
      429,
      'AI_IMAGE_QUOTA_EXCEEDED',
      `Llegaste al limite diario de ${cap} imagenes generadas con IA. Intenta manana.`
    );
  }
}

export type GenerateFoodImageParams = {
  foodName: string;
  description?: string;
  category?: string;
  restaurantName?: string;
};

function buildPrompt(params: GenerateFoodImageParams): string {
  const parts: string[] = [];

  const foodName = params.foodName?.trim() ?? '';
  const category = params.category?.trim() ?? '';
  const description = params.description?.trim() ?? '';

  // El plato es el SUJETO de la foto; la descripción solo lo matiza. FLUX schnell
  // rinde mejor con un objeto claro y frases cortas que con escenas largas.
  const subject = foodName
    ? `${foodName.toLowerCase()}`
    : category
      ? `un plato de la categoria ${category.toLowerCase()}`
      : 'un platillo';

  parts.push(`fotografia de menu de ${subject}`);

  if (category && category.toLowerCase() !== foodName.toLowerCase()) {
    parts.push(`categoria: ${category.slice(0, 60)}`);
  }

  if (description) {
    parts.push(`para que se vea como: ${description.slice(0, 200)}`);
  }

  if (params.restaurantName?.trim()) {
    parts.push(`del restaurante "${params.restaurantName.trim().slice(0, 60)}"`);
  }

  parts.push(
    'foto realista de comida, plato centrado sobre fondo limpio y claro, ' +
      'iluminacion natural suave, aspecto apetitoso, estilo food photography, ' +
      'sin texto, sin marcas de agua, sin manos'
  );

  return parts.join(', ').slice(0, PROMPT_MAX_LENGTH);
}

/**
 * Genera la imagen con Workers AI y devuelve el Base64 de la imagen (JPEG).
 * Lanza AppError 503 si no hay configuración y 502 ante fallos del proveedor.
 */
export async function generateFoodImage(params: GenerateFoodImageParams): Promise<string> {
  const accountId = process.env.CF_ACCOUNT_ID?.trim();
  const apiToken = process.env.CF_API_TOKEN?.trim();

  if (!accountId || !apiToken) {
    throw new AppError(
      503,
      'AI_IMAGE_NOT_CONFIGURED',
      'La generacion de imagenes con IA no esta configurada. Agrega CF_ACCOUNT_ID y CF_API_TOKEN.'
    );
  }

  const prompt = buildPrompt(params);
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${MODEL}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: controller.signal,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === 'AbortError'
        ? 'La generacion de la imagen tardo demasiado. Intenta nuevamente.'
        : error instanceof Error
          ? error.message
          : 'Fallo la conexion con el proveedor de imagenes.';
    logger.error('[AI-Image] No se pudo contactar a Workers AI', { error });
    throw new AppError(502, 'AI_IMAGE_PROVIDER_ERROR', message);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    logger.error('[AI-Image] Workers AI respondio con error', { status: response.status });
    throw new AppError(
      502,
      'AI_IMAGE_PROVIDER_ERROR',
      `El proveedor de imagenes respondio con estado ${response.status}.`
    );
  }

  const body = (await response.json()) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: { image?: string };
  };

  if (!body.success || !body.result?.image) {
    const detail = body.errors?.map((e) => e.message).filter(Boolean).join(' ');
    logger.error('[AI-Image] Workers AI no genero imagen', { errors: body.errors });
    throw new AppError(502, 'AI_IMAGE_PROVIDER_ERROR', detail || 'El proveedor no genero la imagen.');
  }

  const image = body.result.image;
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(image) || image.length < 100) {
    logger.error('[AI-Image] La imagen generada no tiene un formato Base64 valido');
    throw new AppError(502, 'AI_IMAGE_PROVIDER_ERROR', 'La imagen generada por IA no es valida.');
  }

  return image.replace(/\r?\n/g, '');
}