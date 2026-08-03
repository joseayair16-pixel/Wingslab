-- Dynamic delivery pricing per restaurant (own delivery mode)
ALTER TABLE "Restaurant"
  ADD COLUMN "deliveryPricingModel" TEXT NOT NULL DEFAULT 'fixed',
  ADD COLUMN "deliveryBaseRate" DOUBLE PRECISION NOT NULL DEFAULT 20,
  ADD COLUMN "deliveryPerKmRate" DOUBLE PRECISION NOT NULL DEFAULT 8,
  ADD COLUMN "deliveryMinFee" DOUBLE PRECISION NOT NULL DEFAULT 15,
  ADD COLUMN "deliveryMaxFee" DOUBLE PRECISION NOT NULL DEFAULT 150;
