import { OrderStatus } from '@prisma/client';

import { canRestaurantApplyStatus, canRestaurantTransitionTo } from './order-workflow.service';

describe('order workflow transitions', () => {
  it('permite transiciones validas del restaurante', () => {
    expect(canRestaurantTransitionTo(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe(true);
    expect(canRestaurantTransitionTo(OrderStatus.CONFIRMED, OrderStatus.PREPARING)).toBe(true);
    expect(canRestaurantTransitionTo(OrderStatus.PREPARING, OrderStatus.READY)).toBe(true);
  });

  it('bloquea transiciones invalidas del restaurante', () => {
    expect(canRestaurantTransitionTo(OrderStatus.PENDING, OrderStatus.READY)).toBe(false);
    expect(canRestaurantTransitionTo(OrderStatus.REJECTED, OrderStatus.CONFIRMED)).toBe(false);
    expect(canRestaurantTransitionTo(OrderStatus.DELIVERED, OrderStatus.CANCELLED)).toBe(false);
  });

  it('exige el estado de origen correcto para cada botón del panel', () => {
    expect(canRestaurantApplyStatus(OrderStatus.PENDING, OrderStatus.CONFIRMED)).toBe(true);
    expect(canRestaurantApplyStatus(OrderStatus.CONFIRMED, OrderStatus.PREPARING)).toBe(true);
    expect(canRestaurantApplyStatus(OrderStatus.PREPARING, OrderStatus.READY)).toBe(true);
    expect(canRestaurantApplyStatus(OrderStatus.CONFIRMED, OrderStatus.READY)).toBe(true);
    expect(canRestaurantApplyStatus(OrderStatus.PENDING, OrderStatus.REJECTED)).toBe(true);
    expect(canRestaurantApplyStatus(OrderStatus.PENDING, OrderStatus.PREPARING)).toBe(false);
    expect(canRestaurantApplyStatus(OrderStatus.CONFIRMED, OrderStatus.REJECTED)).toBe(false);
  });
});
