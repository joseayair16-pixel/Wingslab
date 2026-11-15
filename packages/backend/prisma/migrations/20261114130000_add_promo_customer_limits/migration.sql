-- Additive coupon rules; existing coupons keep their current behavior.
ALTER TABLE "PromoCode"
    ADD COLUMN "maxUsesPerCustomer" INTEGER,
    ADD COLUMN "firstPurchaseOnly" BOOLEAN NOT NULL DEFAULT false;
