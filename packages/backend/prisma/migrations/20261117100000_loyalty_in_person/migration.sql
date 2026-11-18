-- In-person loyalty: short-lived single-use QR sessions and verifiable visits.
CREATE TABLE "LoyaltyVisit" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "restaurantId" TEXT NOT NULL REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 0),
  "rewardAppliedCents" INTEGER NOT NULL DEFAULT 0,
  "rewardDescription" TEXT,
  "rewardProductId" TEXT,
  "createdBy" TEXT NOT NULL,
  "note" TEXT,
  "voidedAt" TIMESTAMP(3),
  "voidedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoyaltyVisit_restaurantId_customerId_createdAt_idx" ON "LoyaltyVisit"("restaurantId","customerId","createdAt");
CREATE INDEX "LoyaltyVisit_createdBy_idx" ON "LoyaltyVisit"("createdBy");

CREATE TABLE "LoyaltyScanSession" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "restaurantId" TEXT NOT NULL REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "code" TEXT NOT NULL UNIQUE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoyaltyScanSession_expiresAt_idx" ON "LoyaltyScanSession"("expiresAt");
CREATE INDEX "LoyaltyScanSession_customerId_idx" ON "LoyaltyScanSession"("customerId");

ALTER TABLE "LoyaltyStamp" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "LoyaltyStamp" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'ONLINE' CHECK ("source" IN ('ONLINE','IN_PERSON'));
ALTER TABLE "LoyaltyStamp" ADD COLUMN "visitId" TEXT UNIQUE REFERENCES "LoyaltyVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LoyaltyStamp_visitId_idx" ON "LoyaltyStamp"("visitId");
ALTER TABLE "LoyaltyStamp" ADD CONSTRAINT "LoyaltyStamp_one_reference" CHECK (
  ("orderId" IS NOT NULL AND "visitId" IS NULL) OR ("orderId" IS NULL AND "visitId" IS NOT NULL)
);

ALTER TABLE "LoyaltyRedemption" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "LoyaltyRedemption" ADD COLUMN "visitId" TEXT UNIQUE REFERENCES "LoyaltyVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LoyaltyRedemption_visitId_idx" ON "LoyaltyRedemption"("visitId");
ALTER TABLE "LoyaltyRedemption" ADD CONSTRAINT "LoyaltyRedemption_one_reference" CHECK (
  ("orderId" IS NOT NULL AND "visitId" IS NULL) OR ("orderId" IS NULL AND "visitId" IS NOT NULL)
);

GRANT SELECT,INSERT,UPDATE,DELETE ON "LoyaltyVisit","LoyaltyScanSession" TO wingslab_local;
