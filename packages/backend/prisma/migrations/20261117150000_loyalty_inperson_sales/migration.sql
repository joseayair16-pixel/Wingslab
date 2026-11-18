-- Expand in-person loyalty from a manual amount into an auditable local sale.
-- Existing visits are retained and remain readable; their missing tender/items
-- are deliberately NULL/empty rather than inventing historical data.
ALTER TABLE "LoyaltyVisit"
  ADD COLUMN "giftStockDecremented" BOOLEAN,
  ADD COLUMN "itemsJson" TEXT NOT NULL DEFAULT '[]',
  ADD COLUMN "totalCents" INTEGER,
  ADD COLUMN "paymentMethod" TEXT,
  ADD COLUMN "scanSessionId" TEXT UNIQUE REFERENCES "LoyaltyScanSession"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "resultJson" TEXT;

ALTER TABLE "LoyaltyVisit"
  ADD CONSTRAINT "LoyaltyVisit_totalCents_nonnegative" CHECK ("totalCents" IS NULL OR "totalCents" >= 0),
  ADD CONSTRAINT "LoyaltyVisit_paymentMethod_check" CHECK ("paymentMethod" IS NULL OR "paymentMethod" IN ('CASH','CARD','TRANSFER','OTHER'));

CREATE INDEX "LoyaltyScanSession_createdAt_idx" ON "LoyaltyScanSession"("createdAt");

GRANT SELECT,INSERT,UPDATE,DELETE ON "LoyaltyVisit" TO wingslab_local;
