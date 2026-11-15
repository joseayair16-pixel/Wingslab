ALTER TABLE "Order" ADD COLUMN "preparationTimeMinutes" INTEGER;
ALTER TABLE "Order" ADD COLUMN "preparationStartedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "preparationDeadlineAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "etaExtendedMinutes" INTEGER NOT NULL DEFAULT 0;
