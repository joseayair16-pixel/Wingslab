-- WingsLab-owned driver accounts, agreed delivery compensation, and payout ledger.
-- This migration is intentionally not applied by the implementation workflow.

ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Driver"
ALTER COLUMN "documentNumber" DROP NOT NULL,
ALTER COLUMN "documentType" DROP NOT NULL,
ADD COLUMN "restaurantId" TEXT,
ADD COLUMN "deliveryCompensation" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "Order" ADD COLUMN "driverCompensation" DECIMAL(10,2);

CREATE INDEX "Driver_restaurantId_idx" ON "Driver"("restaurantId");
CREATE INDEX "Driver_restaurantId_status_idx" ON "Driver"("restaurantId", "status");

ALTER TABLE "Driver"
ADD CONSTRAINT "Driver_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DriverPayout" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "notes" TEXT,
  "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DriverEarning" (
  "id" TEXT NOT NULL,
  "driverId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amount" DECIMAL(10,2) NOT NULL,
  "payoutId" TEXT,
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DriverEarning_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DriverPayout_reference_key" ON "DriverPayout"("reference");
CREATE INDEX "DriverPayout_restaurantId_driverId_paidAt_idx"
ON "DriverPayout"("restaurantId", "driverId", "paidAt");

CREATE UNIQUE INDEX "DriverEarning_orderId_key" ON "DriverEarning"("orderId");
CREATE INDEX "DriverEarning_driverId_earnedAt_idx" ON "DriverEarning"("driverId", "earnedAt");
CREATE INDEX "DriverEarning_restaurantId_payoutId_idx" ON "DriverEarning"("restaurantId", "payoutId");

ALTER TABLE "DriverPayout"
ADD CONSTRAINT "DriverPayout_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DriverPayout_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DriverEarning"
ADD CONSTRAINT "DriverEarning_driverId_fkey"
FOREIGN KEY ("driverId") REFERENCES "Driver"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DriverEarning_restaurantId_fkey"
FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DriverEarning_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "DriverEarning_payoutId_fkey"
FOREIGN KEY ("payoutId") REFERENCES "DriverPayout"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
