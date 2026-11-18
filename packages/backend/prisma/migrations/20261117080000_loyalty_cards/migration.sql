-- Additive foundation only. No historic orders are changed or rewards consumed.
CREATE TABLE "LoyaltyCard" (
  "id" TEXT PRIMARY KEY,
  "customerId" TEXT NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "restaurantId" TEXT NOT NULL REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0),
  "programVersion" INTEGER NOT NULL CHECK ("programVersion" > 0),
  "goal" INTEGER NOT NULL CHECK ("goal" BETWEEN 2 AND 30),
  "rewardKind" TEXT NOT NULL CHECK ("rewardKind" IN ('AMOUNT', 'PERCENT', 'PRODUCT')),
  "rewardValue" INTEGER,
  "rewardProductId" TEXT,
  "rewardProductName" TEXT,
  "rewardDescription" TEXT NOT NULL,
  "terms" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("state" IN ('OPEN', 'COMPLETED')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "LoyaltyCard_reward_check" CHECK (
    ("rewardKind" = 'AMOUNT' AND "rewardValue" IS NOT NULL AND "rewardValue" > 0 AND "rewardProductId" IS NULL) OR
    ("rewardKind" = 'PERCENT' AND "rewardValue" IS NOT NULL AND "rewardValue" BETWEEN 1 AND 100 AND "rewardProductId" IS NULL) OR
    ("rewardKind" = 'PRODUCT' AND "rewardValue" IS NULL AND "rewardProductId" IS NOT NULL)
  ),
  CONSTRAINT "LoyaltyCard_restaurantId_customerId_sequence_key" UNIQUE ("restaurantId", "customerId", "sequence")
);
CREATE INDEX "LoyaltyCard_restaurantId_customerId_state_idx" ON "LoyaltyCard"("restaurantId", "customerId", "state");
CREATE UNIQUE INDEX "LoyaltyCard_one_open_per_customer" ON "LoyaltyCard"("restaurantId", "customerId") WHERE "state" = 'OPEN';

CREATE TABLE "LoyaltyStamp" (
  "id" TEXT PRIMARY KEY,
  "cardId" TEXT NOT NULL REFERENCES "LoyaltyCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LoyaltyStamp_cardId_idx" ON "LoyaltyStamp"("cardId");

-- Released reservations are deleted atomically with cancellation. Their audit
-- event must be retained separately; completed redemptions are never deleted.
CREATE TABLE "LoyaltyRedemption" (
  "id" TEXT PRIMARY KEY,
  "cardId" TEXT NOT NULL UNIQUE REFERENCES "LoyaltyCard"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL UNIQUE REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "state" TEXT NOT NULL DEFAULT 'RESERVED' CHECK ("state" IN ('RESERVED', 'COMPLETED')),
  "discountCents" INTEGER NOT NULL CHECK ("discountCents" >= 0),
  "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE INDEX "LoyaltyRedemption_state_idx" ON "LoyaltyRedemption"("state");
