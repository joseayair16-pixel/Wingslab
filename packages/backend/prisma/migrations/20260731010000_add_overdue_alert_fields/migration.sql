-- Migration: Add overdue preparation escalation fields
-- Tracks escalating push alerts sent to the restaurant when an order's
-- preparation deadline has passed (overdue orders).
-- overdueAlertLevel counts escalation steps (0 = not alerted yet).
-- overdueAlertedAt is used to dedupe and space out reminders.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "overdueAlertLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "overdueAlertedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Order_overdueAlertLevel_status_idx" ON "Order"("overdueAlertLevel", "status");
