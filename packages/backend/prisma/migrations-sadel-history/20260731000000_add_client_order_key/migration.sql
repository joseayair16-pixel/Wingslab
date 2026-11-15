-- Migration: Add clientOrderKey for idempotent order creation
-- Prevents duplicate orders when the client retries (network error, double tap)
-- after the server already created the order.

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "clientOrderKey" TEXT;

-- Unique key to deduplicate concurrent/retried submissions
CREATE UNIQUE INDEX IF NOT EXISTS "Order_clientOrderKey_key" ON "Order"("clientOrderKey");
