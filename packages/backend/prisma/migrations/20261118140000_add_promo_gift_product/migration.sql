-- Optional gift product for FREE_PRODUCT coupons. Existing coupons are unaffected.
ALTER TABLE "PromoCode"
  ADD COLUMN "giftProductId" TEXT;
