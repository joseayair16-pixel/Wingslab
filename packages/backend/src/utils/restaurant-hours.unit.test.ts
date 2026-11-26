import { RestaurantStatus } from '@prisma/client';
import { getNextOpenTime, isRestaurantOpenNow } from './restaurant';

function hours(dayOfWeek: number, openTime: string, closeTime: string) {
  return {
    id: `${dayOfWeek}-${openTime}`,
    restaurantId: 'restaurant',
    dayOfWeek,
    shiftIndex: 0,
    openTime,
    closeTime,
    isClosed: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

describe('restaurant hours in Mexico City time', () => {
  it('uses the previous day overnight shift and does not treat today’s future shift as open', () => {
    const wednesdayAtOne = new Date('2026-04-15T07:00:00.000Z');
    const tuesdayNight = [hours(2, '22:00', '02:00')];
    const wednesdayNight = [hours(3, '22:00', '02:00')];

    expect(isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, tuesdayNight, wednesdayAtOne)).toBe(true);
    expect(isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, wednesdayNight, wednesdayAtOne)).toBe(false);
  });

  it('keeps the restaurant open only through the 12-minute close grace period', () => {
    const shift = [hours(2, '09:00', '18:00')];
    expect(isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, shift, new Date('2026-04-15T00:11:00.000Z'))).toBe(true);
    expect(isRestaurantOpenNow(RestaurantStatus.ACTIVE, true, false, shift, new Date('2026-04-15T00:13:00.000Z'))).toBe(false);
  });

  it('computes the next opening using Mexico City weekday and clock', () => {
    const tuesdayShift = [hours(2, '12:00', '16:00')];
    expect(getNextOpenTime(tuesdayShift, new Date('2026-04-14T16:00:00.000Z'))).toBe('hoy a las 12:00 pm');
  });
});
