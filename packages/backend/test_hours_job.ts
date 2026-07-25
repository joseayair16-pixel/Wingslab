function isTimeInRange(time: string, start: string, end: string): boolean {
  if (start <= end) {
    return time >= start && time <= end;
  }
  return time >= start || time <= end;
}

function addMinutes(timeString: string, minutesToAdd: number): string {
  const [hStr, mStr] = timeString.split(':');
  let h = parseInt(hStr, 10);
  let m = parseInt(mStr, 10);
  
  m += minutesToAdd;
  h += Math.floor(m / 60);
  m = m % 60;
  h = h % 24;
  
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const mockOperatingHours = [
  { dayOfWeek: 1, openTime: '08:00', closeTime: '22:00', isClosed: false }, // Mon
  { dayOfWeek: 2, openTime: '18:00', closeTime: '02:00', isClosed: false }, // Tue (Crosses midnight to Wed)
  { dayOfWeek: 3, openTime: '10:00', closeTime: '20:00', isClosed: false }, // Wed
  { dayOfWeek: 4, openTime: '10:00', closeTime: '20:00', isClosed: true },  // Thu (Closed)
];

function runTest(testName: string, currentDay: number, currentTime: string, expectedAction: string) {
  let relevantSchedule = null;
  for (const schedule of mockOperatingHours) {
    if (schedule.isClosed) continue;
    
    const crossesMidnight = schedule.closeTime < schedule.openTime;
    const yesterdayDay = currentDay === 0 ? 6 : currentDay - 1;

    if (!crossesMidnight && schedule.dayOfWeek === currentDay) {
      relevantSchedule = schedule;
      break;
    }
    
    if (crossesMidnight) {
      // It's the same day, late evening
      if (schedule.dayOfWeek === currentDay && currentTime >= schedule.openTime) {
        relevantSchedule = schedule;
        break;
      }
      // It's the next day, early morning
      if (schedule.dayOfWeek === yesterdayDay && currentTime <= addMinutes(schedule.closeTime, 180)) {
        relevantSchedule = schedule;
        break;
      }
    }
  }

  let action = 'NO_ACTION';
  if (relevantSchedule) {
    const { openTime, closeTime } = relevantSchedule;
    if (isTimeInRange(currentTime, openTime, addMinutes(openTime, 4))) action = 'PROMPT_OPEN';
    else if (isTimeInRange(currentTime, addMinutes(openTime, 15), addMinutes(openTime, 19))) action = 'PROMPT_LATE_OPEN';
    else if (isTimeInRange(currentTime, closeTime, addMinutes(closeTime, 9))) action = 'PROMPT_CLOSE';
    else if (isTimeInRange(currentTime, addMinutes(closeTime, 10), addMinutes(closeTime, 180))) action = 'AUTO_CLOSE';
  }

  console.log(`[${testName}] Day: ${currentDay}, Time: ${currentTime} -> Result: ${action} | Expected: ${expectedAction}`);
  if (action !== expectedAction) {
    console.error(`  FAIL! Expected ${expectedAction} but got ${action}\n  Schedule matched:`, relevantSchedule);
  }
}

console.log("--- RUNNING TESTS ---");

// Test 1: Normal open time (Mon 08:00)
runTest('Normal Open', 1, '08:02', 'PROMPT_OPEN');

// Test 2: Normal late open (Mon 08:15)
runTest('Late Open', 1, '08:17', 'PROMPT_LATE_OPEN');

// Test 3: Normal close prompt (Mon 22:05)
runTest('Normal Close Prompt', 1, '22:05', 'PROMPT_CLOSE');

// Test 4: Normal auto close (Mon 22:15)
runTest('Normal Auto Close', 1, '22:15', 'AUTO_CLOSE');

// Test 5: Cross-midnight open (Tue 18:00)
runTest('Cross Open', 2, '18:01', 'PROMPT_OPEN');

// Test 6: Cross-midnight before midnight
runTest('Cross Before Midnight', 2, '23:30', 'NO_ACTION');

// Test 7: Cross-midnight close prompt (Wed 02:05 - actually Tuesday's shift!)
runTest('Cross Close Prompt', 3, '02:05', 'PROMPT_CLOSE');

// Test 8: Cross-midnight auto close (Wed 02:20 - actually Tuesday's shift!)
runTest('Cross Auto Close', 3, '02:20', 'AUTO_CLOSE');

// Test 9: Wed morning shift (Wed 10:00 - should not match Tuesday's cross midnight)
runTest('Wed Open', 3, '10:02', 'PROMPT_OPEN');

// Test 10: Closed day (Thu 10:00)
runTest('Closed Day', 4, '10:02', 'NO_ACTION');

