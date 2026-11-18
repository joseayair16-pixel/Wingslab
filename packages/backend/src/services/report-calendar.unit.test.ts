import { calendarReportRange } from './report-calendar';

test('week boundaries follow Monday in Mexico City, including year boundaries', () => {
  const now = new Date('2026-01-01T04:00:00Z');
  expect(calendarReportRange(now, undefined, 0)).toEqual({ from: new Date('2025-12-29T06:00:00Z'), to: new Date('2026-01-05T06:00:00Z') });
  expect(calendarReportRange(now, undefined, 6).from).toEqual(new Date('2025-11-17T06:00:00Z'));
});

test('day range respects historical Mexico City daylight saving and rejects invalid dates', () => {
  const now = new Date('2026-11-17T18:00:00Z');
  expect(calendarReportRange(now, '2021-04-04')).toEqual({ from: new Date('2021-04-04T06:00:00Z'), to: new Date('2021-04-05T05:00:00Z') });
  expect(() => calendarReportRange(now, '2026-02-30')).toThrow();
});
