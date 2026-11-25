ALTER TABLE "Restaurant" ADD COLUMN "acceptsCard" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CheckoutPaymentIntent" ADD COLUMN "declineReason" TEXT;
