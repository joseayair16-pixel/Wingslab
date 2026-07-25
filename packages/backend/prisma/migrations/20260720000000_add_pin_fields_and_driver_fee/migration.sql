-- Migration: Add handoverPinAttempts, handoverPinUpdatedAt, deliveryPin, driverPlatformFee
-- These fields were added via db push and are missing from existing migrations

-- Add handoverPinAttempts to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "handoverPinAttempts" INTEGER NOT NULL DEFAULT 0;

-- Add handoverPinUpdatedAt to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "handoverPinUpdatedAt" TIMESTAMP(3);

-- Add deliveryPin to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "deliveryPin" TEXT;

-- Add driverPlatformFee to Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "driverPlatformFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Add index for stuck orders (if not exists)
-- Note: index creation is idempotent in PG, IF NOT EXISTS is implicit for indexes
CREATE INDEX IF NOT EXISTS "Order_stuckAlertLevel_status_idx" ON "Order"("stuckAlertLevel", "status");
