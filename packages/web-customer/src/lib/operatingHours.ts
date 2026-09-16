/**
 * Helpers de horario de atención (shared entre home y detalle del restaurante).
 * Operan sobre el formato que devuelve el backend (OperatingHours).
 */
export type OperatingHourItem = {
  dayOfWeek: number; // 0 = domingo
  shiftIndex?: number;
  openTime: string; // HH:mm
  closeTime: string; // HH:mm
  isClosed: boolean;
};

export const WEEKDAY_LABELS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'] as const;

export function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map((p) => parseInt(p, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** 13:00 → "1:00 pm". */
export function formatHour12(hhmm: string): string {
  const minutes = parseHHMM(hhmm);
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'p.m.' : 'a.m.';
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

export type WeekRow = { dayOfWeek: number; label: string; shifts: { openTime: string; closeTime: string }[] };

/** Semana Lunes→Domingo con los turnos de cada día (agrupados y ordenados). */
export function buildWeekSchedule(operatingHours: readonly OperatingHourItem[] | null | undefined): WeekRow[] {
  const byDay: Record<number, { openTime: string; closeTime: string }[]> = {};
  for (const b of operatingHours ?? []) {
    if (b.isClosed) continue;
    const list = byDay[b.dayOfWeek] ?? (byDay[b.dayOfWeek] = []);
    list.push({ openTime: b.openTime, closeTime: b.closeTime });
  }
  const orderedDays = [1, 2, 3, 4, 5, 6, 0];
  return orderedDays.map((dayOfWeek) => ({
    dayOfWeek,
    label: WEEKDAY_LABELS[dayOfWeek === 0 ? 6 : dayOfWeek - 1],
    shifts: (byDay[dayOfWeek] ?? []).sort((a, b) => parseHHMM(a.openTime) - parseHHMM(b.openTime)),
  }));
}

/** Con el negocio abierto, la hora de cierre del turno vigente (respeta madrugada). */
export function getCurrentShiftClose(hours: readonly OperatingHourItem[] | null | undefined, now: Date): string | null {
  if (!hours?.length) return null;
  const day = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const inShift = (open: string, close: string) => {
    const o = parseHHMM(open);
    const c = parseHHMM(close);
    return o <= c ? nowMin >= o && nowMin < c : nowMin >= o || nowMin < c; // overnight
  };
  const yesterday = (day + 6) % 7;
  const candidates = hours.filter(
    (b) => !b.isClosed && ((b.dayOfWeek === day && inShift(b.openTime, b.closeTime)) || (b.dayOfWeek === yesterday && parseHHMM(b.closeTime) < parseHHMM(b.openTime) && nowMin < parseHHMM(b.closeTime))),
  );
  return candidates[0]?.closeTime ?? null;
}

/** "2026-09-11T21:00:00Z" → "mañana a las 9:00 p.m." / "hoy a las 9:00 a.m.". */
export function formatNextOpen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' }).format(date);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(date) - startOfDay(new Date())) / 86400000);
  if (diffDays === 0) return `hoy a las ${time}`;
  if (diffDays === 1) return `mañana a las ${time}`;
  const weekday = new Intl.DateTimeFormat('es-MX', { weekday: 'long' }).format(date);
  return `el ${weekday} a las ${time}`;
}
