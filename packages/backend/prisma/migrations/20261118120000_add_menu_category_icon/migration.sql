-- Optional icon for menu categories. Empty values keep the automatic
-- name-based icon inference used by the customer storefront.
ALTER TABLE "MenuCategory"
  ADD COLUMN "icon" TEXT;
