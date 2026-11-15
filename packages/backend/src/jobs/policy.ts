/** Capability inventory, independent from cron registration and domain logic. */
export const JOB_GROUPS = {
  orderLifecycle: ['orderTimeout', 'restaurantHours', 'pickupReady', 'ownDeliveryTimeout'],
  notifications: ['paymentReminders', 'thankYouMessages', 'driverPickupAlert', 'stuckOrder', 'customerPickupReminder',
    'customerArrivalReminder', 'overduePreparation', 'scheduledDeliveryReminder', 'notificationRetry', 'orderRing'],
  maintenance: ['cleanupPushSubscriptions'],
  externalStorage: ['cleanupOrphanMedia'],
} as const;
export type JobName = typeof JOB_GROUPS[keyof typeof JOB_GROUPS][number];
export type JobSelection = Partial<Record<JobName, boolean>>;
export type JobStarters = Record<JobName, () => unknown>;

export function validateJobSelection(requested: JobSelection = {}): Readonly<Record<JobName, boolean>> {
  const names = Object.values(JOB_GROUPS).flat() as JobName[];
  for (const [name, enabled] of Object.entries(requested)) {
    if (!names.includes(name as JobName) || typeof enabled !== 'boolean') throw new Error('[WingsLab] Invalid job selection.');
    if (enabled) throw new Error(`[WingsLab] Job ${name} is not authorized in Phase 2A.`);
  }
  return Object.freeze(Object.fromEntries(names.map(name => [name, false])) as Record<JobName, boolean>);
}

export function startSelectedJobs(requested: JobSelection, starters: JobStarters): void {
  const selection = validateJobSelection(requested); // Entire plan validated before any starter.
  for (const name of Object.keys(selection) as JobName[]) if (selection[name]) starters[name]();
}
