-- Per-order WhatsApp notification fee charged to the restaurant
ALTER TABLE "Order"
  ADD COLUMN "whatsappFee" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "RestaurantBillingSettlement"
  ADD COLUMN "whatsappFeeTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;