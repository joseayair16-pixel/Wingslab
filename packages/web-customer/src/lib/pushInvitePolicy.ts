/**
 * Política de aparición del modal «No te pierdas nada» (invitación a push).
 *
 * Todo lo decidible es puro y recibe el tiempo por parámetro para que sea
 * verificable sin temporizadores. El componente aporta el estado persistido
 * (localStorage) y de sesión (sessionStorage) leído con helpers seguros.
 *
 * Reglas:
 * - Máximo una aparición automática por sesión de navegación.
 * - «Ahora no» / X suprime 7 días entre sesiones (reaparición moderada).
 * - Una aparición automática suprime el resto del día (cubre recargas y
 *   reinicios inmediatos de PWA/APK, donde sessionStorage puede perderse).
 * - El cierre nunca se interpreta como denegación del permiso del sistema.
 */

export const INVITE_SESSION_KEY = 'sadel-customer-push-invite-shown';
export const INVITE_DISMISSED_AT_KEY = 'sadel-customer-push-invite-dismissed-at';
export const INVITE_LAST_SHOWN_AT_KEY = 'sadel-customer-push-invite-last-shown-at';
/** Clave heredada (booleano permanente): se migra a dismissedAt una sola vez. */
export const INVITE_LEGACY_DISMISSED_KEY = 'sadel-customer-push-banner-dismissed';

/** Supresión tras «Ahora no» / X: una semana. */
export const INVITE_DISMISS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
/** Tras una aparición automática: no insistir el mismo día. */
export const INVITE_RESHOW_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type InviteVariant = 'invite' | 'denied-guidance' | 'ios-install' | 'none';

export function selectInviteVariant(input: {
  permission: NotificationPermission;
  isSubscribed: boolean;
  pushSupportIssue: string | null;
  needsIosInstall: boolean;
}): InviteVariant {
  // Caso A: permiso concedido → jamás invitar. La sincronización del token
  // corre por su propio flujo en segundo plano; un fallo ahí es técnico,
  // no un permiso desactivado.
  if (input.permission === 'granted') return 'none';
  // Caso D: plataforma no compatible → no invitar ni intentar nada.
  if (input.pushSupportIssue) return 'none';
  // Sin suscripción pendiente no hay nada que pedir.
  if (input.isSubscribed) return 'none';
  // Caso C: denegado → guía a ajustes, nunca promesa de activación directa.
  if (input.permission === 'denied') return 'denied-guidance';
  if (input.needsIosInstall) return 'ios-install';
  if (input.permission === 'default') return 'invite';
  return 'none';
}

export function isInviteSuppressed(input: {
  now: number;
  shownThisSession: boolean;
  dismissedAt: number | null;
  lastAutoShownAt: number | null;
}): { suppressed: boolean; reason: string } {
  if (input.shownThisSession) {
    return { suppressed: true, reason: 'shown-this-session' };
  }
  if (
    typeof input.dismissedAt === 'number' &&
    Number.isFinite(input.dismissedAt) &&
    input.now - input.dismissedAt < INVITE_DISMISS_COOLDOWN_MS
  ) {
    return { suppressed: true, reason: 'dismiss-cooldown' };
  }
  if (
    typeof input.lastAutoShownAt === 'number' &&
    Number.isFinite(input.lastAutoShownAt) &&
    input.now - input.lastAutoShownAt < INVITE_RESHOW_COOLDOWN_MS
  ) {
    return { suppressed: true, reason: 'reshow-cooldown' };
  }
  return { suppressed: false, reason: 'eligible' };
}

function safeGet(store: 'local' | 'session', key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = store === 'local' ? window.localStorage : window.sessionStorage;
    if (!storage) return null;
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(store: 'local' | 'session', key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return;
    const storage = store === 'local' ? window.localStorage : window.sessionStorage;
    if (!storage) return;
    storage.setItem(key, value);
  } catch {
    /* almacenamiento no disponible: la política se degrada a la sesión en memoria */
  }
}

function readTimestamp(key: string): number | null {
  const raw = safeGet('local', key);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Lee el estado persistido, migrando la bandera heredada una sola vez. */
export function readInvitePersistedState(now: number): {
  dismissedAt: number | null;
  lastAutoShownAt: number | null;
} {
  let dismissedAt = readTimestamp(INVITE_DISMISSED_AT_KEY);
  if (dismissedAt === null && safeGet('local', INVITE_LEGACY_DISMISSED_KEY) === 'true') {
    // Quien ya lo había descartado conserva su decisión con ventana fresca.
    dismissedAt = now;
    safeSet('local', INVITE_DISMISSED_AT_KEY, String(now));
    try {
      window.localStorage.removeItem(INVITE_LEGACY_DISMISSED_KEY);
    } catch {
      /* noop */
    }
  }
  return { dismissedAt, lastAutoShownAt: readTimestamp(INVITE_LAST_SHOWN_AT_KEY) };
}

export function wasInviteShownThisSession(): boolean {
  return safeGet('session', INVITE_SESSION_KEY) === '1';
}

/** Registra una aparición automática (una por sesión + tope diario). */
export function markInviteAutoShown(now: number): void {
  safeSet('session', INVITE_SESSION_KEY, '1');
  safeSet('local', INVITE_LAST_SHOWN_AT_KEY, String(now));
}

/** «Ahora no» / X / denegación real del sistema: suprime 7 días. */
export function markInviteDismissed(now: number): void {
  safeSet('session', INVITE_SESSION_KEY, '1');
  safeSet('local', INVITE_DISMISSED_AT_KEY, String(now));
}

/** Supresión solo de sesión (fallo técnico sin veredicto del usuario). */
export function markInviteSuppressedForSession(): void {
  safeSet('session', INVITE_SESSION_KEY, '1');
}
