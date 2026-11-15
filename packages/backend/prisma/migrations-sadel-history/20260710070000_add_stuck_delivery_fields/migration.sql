-- Add stuck delivery escalation fields to Order
ALTER TABLE "Order" ADD COLUMN "stuckAlertLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "stuckAlertedAt" TIMESTAMP(3);
