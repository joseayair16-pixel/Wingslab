/** Pure calculations for a versioned loyalty cycle. This does not authorize a
 * checkout or reserve a reward; those operations must occur transactionally. */
export function loyaltyProgress(input: { completedOrders: number; redeemedRewards: number; goal: number; rewardReserved: boolean }) {
  const { completedOrders, redeemedRewards, goal, rewardReserved } = input;
  if (!Number.isSafeInteger(completedOrders) || completedOrders < 0 || !Number.isSafeInteger(redeemedRewards) || redeemedRewards < 0 || !Number.isSafeInteger(goal) || goal < 2 || goal > 30) {
    throw new Error('Invalid loyalty progress');
  }
  const earnedRewards = Math.floor(completedOrders / goal);
  if (redeemedRewards > earnedRewards) throw new Error('Redeemed rewards exceed completed cycles');
  const availableRewards = earnedRewards - redeemedRewards;
  const stamps = completedOrders % goal;
  return {
    stamps,
    availableRewards,
    rewardReserved,
    // Previously earned rewards take precedence over a completing purchase.
    eligibleForNextOrder: !rewardReserved && (availableRewards > 0 || stamps === goal - 1),
    eligibility: rewardReserved ? 'reserved' : availableRewards > 0 ? 'earned' : stamps === goal - 1 ? 'completing' : 'not_ready',
  } as const;
}

/** Money is provided and returned in integer centavos; delivery is excluded. */
export function loyaltyDiscount(input: { subtotalCents: number; kind: 'amount' | 'percent'; value: number; otherPromotionApplied: boolean }) {
  const { subtotalCents, kind, value, otherPromotionApplied } = input;
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0 || !Number.isSafeInteger(value) || value <= 0 || (kind === 'percent' && value > 100)) {
    throw new Error('Invalid loyalty discount');
  }
  if (otherPromotionApplied) throw new Error('Loyalty rewards cannot be combined with other promotions');
  return Math.min(subtotalCents, kind === 'amount' ? value : Math.round(subtotalCents * value / 100));
}
