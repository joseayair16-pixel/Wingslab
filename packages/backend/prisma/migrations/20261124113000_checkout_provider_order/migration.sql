ALTER TABLE "CheckoutPaymentIntent" ADD COLUMN "providerOrderId" TEXT;
CREATE UNIQUE INDEX "CheckoutPaymentIntent_providerOrderId_key" ON "CheckoutPaymentIntent" ("providerOrderId");
