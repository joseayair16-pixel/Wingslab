-- Migration: Abandoned delivery security
-- 1) Track when the driver arrives at the CUSTOMER's door (distinct from
--    driverArrivedAt which marks arrival at the restaurant for pickup).
--    Used to enforce the 10min (transfer) / 15min (cash) no-contact thresholds.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "driverArrivedAtCustomer" TIMESTAMP(3);

-- 2) Customer debt: a customer that never came out to receive a CASH order
--    gets a billing settlement + suspension until they pay.
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "isSuspendedByDebt" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "debtAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 3) Ensure the shared status enum includes REJECTED (idempotent, no-op if present).
ALTER TYPE "BillingSettlementStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- 3) Customer billing settlements (mirrors DriverBillingSettlement).
CREATE TABLE IF NOT EXISTS "CustomerBillingSettlement" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "orderId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "BillingSettlementStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "paymentProofUrl" TEXT,
    "dueDate" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBillingSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerBillingSettlement_reference_key" ON "CustomerBillingSettlement"("reference");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerBillingSettlement_orderId_key" ON "CustomerBillingSettlement"("orderId");
CREATE INDEX IF NOT EXISTS "CustomerBillingSettlement_customerId_idx" ON "CustomerBillingSettlement"("customerId");
CREATE INDEX IF NOT EXISTS "CustomerBillingSettlement_status_idx" ON "CustomerBillingSettlement"("status");

ALTER TABLE "CustomerBillingSettlement" ADD CONSTRAINT "CustomerBillingSettlement_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CustomerBillingSettlement" ADD CONSTRAINT "CustomerBillingSettlement_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
