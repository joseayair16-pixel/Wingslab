-- Dynamic delivery pricing per region
ALTER TABLE "Region"
  ADD COLUMN "pricingModel" TEXT NOT NULL DEFAULT 'fixed',
  ADD COLUMN "baseRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  ADD COLUMN "perKmRate" DOUBLE PRECISION NOT NULL DEFAULT 8,
  ADD COLUMN "minDeliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 15,
  ADD COLUMN "maxDeliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 150;

-- Track calculated distance per order for audit trail
ALTER TABLE "Order"
  ADD COLUMN "deliveryDistanceKm" DOUBLE PRECISION;
