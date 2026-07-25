const DAYS_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatTime12h(time24h) {
  const [hStr, mStr] = time24h.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${mStr} ${ampm}`;
}

function getNextOpenTime(operatingHours, currentDate = new Date()) {
  if (!operatingHours || operatingHours.length === 0) return null;

  const currentDay = currentDate.getDay();
  const currentTime = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}`;

  const todaySchedule = operatingHours.find((h) => h.dayOfWeek === currentDay);
  if (todaySchedule && !todaySchedule.isClosed) {
    if (currentTime < todaySchedule.openTime) {
      return `hoy a las ${formatTime12h(todaySchedule.openTime)}`;
    } else if (currentTime >= todaySchedule.openTime && currentTime <= todaySchedule.closeTime) {
      const [currH, currM] = currentTime.split(':').map(Number);
      const [openH, openM] = todaySchedule.openTime.split(':').map(Number);
      const diffMinutes = (currH * 60 + currM) - (openH * 60 + openM);

      if (diffMinutes <= 90) {
        return 'pronto';
      }
    }
  }

  for (let i = 1; i <= 6; i++) {
    const nextDay = (currentDay + i) % 7;
    const schedule = operatingHours.find((h) => h.dayOfWeek === nextDay);
    if (schedule && !schedule.isClosed) {
      if (i === 1) return `mañana a las ${formatTime12h(schedule.openTime)}`;
      return `el ${DAYS_ES[nextDay]} a las ${formatTime12h(schedule.openTime)}`;
    }
  }

  return 'pronto';
}

console.log(getNextOpenTime([
  { dayOfWeek: 2, isClosed: false, openTime: "14:00", closeTime: "22:00" } // Tuesday
], new Date("2026-06-23T11:58:28-06:00"))); // Tuesday 11:58
