CREATE TABLE "CheckoutPaymentIntent" (
  "id" UUID PRIMARY KEY,
  "customerId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" > 0),
  "snapshot" JSONB NOT NULL,
  "stock" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CheckoutPaymentIntent_customerId_requestKey_key" ON "CheckoutPaymentIntent" ("customerId", "requestKey");
CREATE INDEX "CheckoutPaymentIntent_state_expiresAt_idx" ON "CheckoutPaymentIntent" ("state", "expiresAt");
