CREATE TABLE "KitchenOrderOutbox" (
  "orderId" TEXT PRIMARY KEY,
  "restaurantId" TEXT NOT NULL,
  "orderCreatedAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "KitchenOrderOutbox_status_nextAttemptAt_idx" ON "KitchenOrderOutbox" ("status", "nextAttemptAt");

CREATE TABLE "CheckoutRefundRequest" (
  "id" UUID PRIMARY KEY,
  "orderId" TEXT NOT NULL UNIQUE,
  "intentId" UUID NOT NULL,
  "providerOrderId" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CheckoutRefundRequest_state_nextAttemptAt_idx" ON "CheckoutRefundRequest" ("state", "nextAttemptAt");
