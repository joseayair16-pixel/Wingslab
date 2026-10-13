/**
 * Política del modal «No te pierdas nada»: variante según estado real y
 * frecuencia (una por sesión, cooldowns entre sesiones). Todo puro salvo la
 * capa fina de almacenamiento, que se prueba con stubs en memoria.
 */
import {
  INVITE_DISMISSED_AT_KEY,
  INVITE_DISMISS_COOLDOWN_MS,
  INVITE_LAST_SHOWN_AT_KEY,
  INVITE_LEGACY_DISMISSED_KEY,
  INVITE_RESHOW_COOLDOWN_MS,
  INVITE_SESSION_KEY,
  isInviteSuppressed,
  markInviteAutoShown,
  markInviteDismissed,
  markInviteSuppressedForSession,
  readInvitePersistedState,
  selectInviteVariant,
  wasInviteShownThisSession,
} from './pushInvitePolicy';

const DAY = 24 * 60 * 60 * 1000;

function memoryStorage() {
  const mem: Record<string, string> = {};
  return {
    getItem: (k: string): string | null => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string): void => {
      mem[k] = String(v);
    },
    removeItem: (k: string): void => {
      delete mem[k];
    },
    clear: (): void => {
      for (const k of Object.keys(mem)) delete mem[k];
    },
    __mem: mem,
  };
}

function installStub() {
  const local = memoryStorage();
  let session = memoryStorage();
  (globalThis as any).window = { localStorage: local, sessionStorage: session };
  return {
    local,
    resetSession: () => {
      session = memoryStorage();
      (globalThis as any).window.sessionStorage = session;
    },
  };
}

beforeEach(() => {
  installStub();
});

afterEach(() => {
  delete (globalThis as any).window;
});

describe('selectInviteVariant: el modal depende del estado real', () => {
  it('1+6. permiso granted: nunca invita, haya o no suscripción', () => {
    expect(
      selectInviteVariant({ permission: 'granted', isSubscribed: false, pushSupportIssue: null, needsIosInstall: false }),
    ).toBe('none');
    expect(
      selectInviteVariant({ permission: 'granted', isSubscribed: true, pushSupportIssue: null, needsIosInstall: false }),
    ).toBe('none');
  });

  it('2. permiso default sin suscripción: invita', () => {
    expect(
      selectInviteVariant({ permission: 'default', isSubscribed: false, pushSupportIssue: null, needsIosInstall: false }),
    ).toBe('invite');
  });

  it('10. ya suscrito: no invita aunque el permiso siga default', () => {
    expect(
      selectInviteVariant({ permission: 'default', isSubscribed: true, pushSupportIssue: null, needsIosInstall: false }),
    ).toBe('none');
  });

  it('5. permiso denied: guía a ajustes, jamás invitación activable', () => {
    expect(
      selectInviteVariant({ permission: 'denied', isSubscribed: false, pushSupportIssue: null, needsIosInstall: false }),
    ).toBe('denied-guidance');
  });

  it('9. plataforma incompatible: no invita ni intenta nada', () => {
    expect(
      selectInviteVariant({ permission: 'default', isSubscribed: false, pushSupportIssue: 'Sin soporte', needsIosInstall: false }),
    ).toBe('none');
    expect(
      selectInviteVariant({ permission: 'denied', isSubscribed: false, pushSupportIssue: 'Sin soporte', needsIosInstall: false }),
    ).toBe('none');
  });

  it('iOS sin instalar: guía de instalación, no invitación genérica', () => {
    expect(
      selectInviteVariant({ permission: 'default', isSubscribed: false, pushSupportIssue: null, needsIosInstall: true }),
    ).toBe('ios-install');
  });

  it('8. transición default → granted: deja de ser elegible', () => {
    const base = { isSubscribed: false, pushSupportIssue: null as string | null, needsIosInstall: false };
    expect(selectInviteVariant({ ...base, permission: 'default' })).toBe('invite');
    expect(selectInviteVariant({ ...base, permission: 'granted' })).toBe('none');
  });

  it('estado desconocido: no invita por defecto', () => {
    expect(
      selectInviteVariant({ permission: 'denied' as NotificationPermission, isSubscribed: true, pushSupportIssue: null, needsIosInstall: false }),
    ).toBe('none');
  });
});

describe('isInviteSuppressed: frecuencia profesional', () => {
  const T0 = 1_700_000_000_000;

  it('3. mostrado en la sesión: no repite', () => {
    expect(
      isInviteSuppressed({ now: T0, shownThisSession: true, dismissedAt: null, lastAutoShownAt: null }).suppressed,
    ).toBe(true);
  });

  it('3+11. «Ahora no» suprime 7 días, luego reaparece moderadamente', () => {
    const dismissedAt = T0;
    expect(
      isInviteSuppressed({ now: T0 + 6 * DAY, shownThisSession: false, dismissedAt, lastAutoShownAt: null }),
    ).toEqual({ suppressed: true, reason: 'dismiss-cooldown' });
    expect(
      isInviteSuppressed({ now: T0 + 8 * DAY, shownThisSession: false, dismissedAt, lastAutoShownAt: null }),
    ).toEqual({ suppressed: false, reason: 'eligible' });
  });

  it('4. aparición automática suprime el resto del día (recargas/reinicios)', () => {
    const lastAutoShownAt = T0;
    expect(
      isInviteSuppressed({ now: T0 + 23 * 60 * 60 * 1000, shownThisSession: false, dismissedAt: null, lastAutoShownAt }),
    ).toEqual({ suppressed: true, reason: 'reshow-cooldown' });
    expect(
      isInviteSuppressed({ now: T0 + 25 * 60 * 60 * 1000, shownThisSession: false, dismissedAt: null, lastAutoShownAt }),
    ).toEqual({ suppressed: false, reason: 'eligible' });
  });

  it('estado fresco: elegible', () => {
    expect(
      isInviteSuppressed({ now: T0, shownThisSession: false, dismissedAt: null, lastAutoShownAt: null }),
    ).toEqual({ suppressed: false, reason: 'eligible' });
  });

  it('timestamps corruptos no suprimen para siempre', () => {
    expect(
      isInviteSuppressed({ now: T0, shownThisSession: false, dismissedAt: NaN, lastAutoShownAt: null }).suppressed,
    ).toBe(false);
  });
});

describe('persistencia: sesión + cooldowns', () => {
  const T0 = 1_700_000_000_000;

  it('markInviteAutoShown: marca sesión y fecha diaria', () => {
    expect(wasInviteShownThisSession()).toBe(false);
    markInviteAutoShown(T0);
    expect(wasInviteShownThisSession()).toBe(true);
    expect(readInvitePersistedState(T0 + 1000)).toEqual({ dismissedAt: null, lastAutoShownAt: T0 });
  });

  it('markInviteDismissed: sesión + cooldown de 7 días', () => {
    markInviteDismissed(T0);
    expect(wasInviteShownThisSession()).toBe(true);
    expect(readInvitePersistedState(T0)).toEqual({ dismissedAt: T0, lastAutoShownAt: null });
    const check = isInviteSuppressed({
      now: T0 + INVITE_DISMISS_COOLDOWN_MS - 1,
      shownThisSession: false,
      ...(readInvitePersistedState(T0 + INVITE_DISMISS_COOLDOWN_MS - 1)),
    });
    expect(check.suppressed).toBe(true);
  });

  it('markInviteSuppressedForSession: solo sesión, sin quemar cooldown', () => {
    markInviteSuppressedForSession();
    expect(wasInviteShownThisSession()).toBe(true);
    expect(readInvitePersistedState(T0)).toEqual({ dismissedAt: null, lastAutoShownAt: null });
  });

  it('migra la bandera heredada una sola vez', () => {
    window.localStorage.setItem(INVITE_LEGACY_DISMISSED_KEY, 'true');
    const state = readInvitePersistedState(T0);
    expect(state.dismissedAt).toBe(T0);
    expect(window.localStorage.getItem(INVITE_LEGACY_DISMISSED_KEY)).toBeNull();
    // Segunda lectura: ya migrado, sin cambios.
    expect(readInvitePersistedState(T0 + 5000)).toEqual({ dismissedAt: T0, lastAutoShownAt: null });
  });

  it('constantes de política documentadas', () => {
    expect(INVITE_DISMISS_COOLDOWN_MS).toBe(7 * DAY);
    expect(INVITE_RESHOW_COOLDOWN_MS).toBe(DAY);
  });
});

describe('flujo completo entre sesiones', () => {
  const T0 = 1_700_000_000_000;

  function eligibleNow(at: number): boolean {
    const persisted = readInvitePersistedState(at);
    return !isInviteSuppressed({
      now: at,
      shownThisSession: wasInviteShownThisSession(),
      dismissedAt: persisted.dismissedAt,
      lastAutoShownAt: persisted.lastAutoShownAt,
    }).suppressed;
  }

  it('2+3+4+11. sesión 1 muestra una vez; recarga no repite; al día siguiente sí; «ahora no» calla 7 días', () => {
    // Sesión 1, fresco: elegible.
    expect(eligibleNow(T0)).toBe(true);
    markInviteAutoShown(T0);
    // Recarga (misma sesión): suprimido.
    expect(eligibleNow(T0 + 60_000)).toBe(false);
    // Reinicio inmediato (sesión nueva, mismo día): suprimido por tope diario.
    (globalThis as any).window.sessionStorage.clear();
    expect(eligibleNow(T0 + 3_600_000)).toBe(false);
    // Al día siguiente: elegible de nuevo.
    (globalThis as any).window.sessionStorage.clear();
    expect(eligibleNow(T0 + 25 * 60 * 60 * 1000)).toBe(true);
    // Usuario pulsa «Ahora no»: silencio 7 días aunque cambie de sesión.
    markInviteDismissed(T0 + 25 * 60 * 60 * 1000);
    (globalThis as any).window.sessionStorage.clear();
    expect(eligibleNow(T0 + 25 * 60 * 60 * 1000 + 6 * DAY)).toBe(false);
    (globalThis as any).window.sessionStorage.clear();
    expect(eligibleNow(T0 + 25 * 60 * 60 * 1000 + 8 * DAY)).toBe(true);
  });

  it('10. navegar entre páginas no duplica: la sesión manda', () => {
    expect(eligibleNow(T0)).toBe(true);
    markInviteAutoShown(T0);
    // Cada remontaje reevalúa contra el mismo almacenamiento.
    for (let i = 0; i < 5; i += 1) {
      expect(eligibleNow(T0 + i * 1000)).toBe(false);
    }
  });

  it('las claves usadas existen y son las documentadas', () => {
    markInviteAutoShown(T0);
    markInviteDismissed(T0 + 1);
    expect(window.localStorage.getItem(INVITE_LAST_SHOWN_AT_KEY)).toBe(String(T0));
    expect(window.localStorage.getItem(INVITE_DISMISSED_AT_KEY)).toBe(String(T0 + 1));
    expect(window.sessionStorage.getItem(INVITE_SESSION_KEY)).toBe('1');
  });
});
