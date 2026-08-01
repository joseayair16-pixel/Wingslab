-- Migration: Arrival reminder for customers
-- Track whether the friendly "driver is at your door" reminder has been sent,
-- so the cron job sends it exactly once (5 min after driver arrival) per order.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "lastArrivalReminderSentAt" TIMESTAMP(3);
