-- Per-restaurant maximum cash order amount (was previously hardcoded to 500)
ALTER TABLE "Restaurant"
  ADD COLUMN "maxCashOrder" DOUBLE PRECISION NOT NULL DEFAULT 500;
