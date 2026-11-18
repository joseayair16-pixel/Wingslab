const zone = 'America/Mexico_City';
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function parts(date: Date) {
  return Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, Number(part.value)]));
}

function midnight(year: number, month: number, day: number): Date {
  const target = Date.UTC(year, month - 1, day);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(instant));
    instant += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }
  return new Date(instant);
}

export function calendarReportRange(now: Date, date?: string, weekOffset?: number) {
  const today = parts(now);
  let day: Date;
  if (date) {
    const [year, month, dateOfMonth] = date.split('-').map(Number);
    day = new Date(Date.UTC(year, month - 1, dateOfMonth));
    if (day.getUTCFullYear() !== year || day.getUTCMonth() !== month - 1 || day.getUTCDate() !== dateOfMonth) throw new Error('Fecha inválida');
  } else {
    day = new Date(Date.UTC(today.year, today.month - 1, today.day));
    day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) - 7 * (weekOffset ?? 0));
  }
  const endDay = new Date(day);
  endDay.setUTCDate(endDay.getUTCDate() + (date ? 1 : 7));
  return { from: midnight(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()), to: midnight(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate()) };
}
