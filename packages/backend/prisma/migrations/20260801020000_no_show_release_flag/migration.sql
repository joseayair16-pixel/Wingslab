-- Migration: No-show release flag
-- Marks orders released by the driver because the customer never came out
-- ("cliente no salió"). The driver UI uses this to show such orders as
-- released-with-customer-debt instead of a normal delivered order.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "noShowReleasedAt" TIMESTAMP(3);
