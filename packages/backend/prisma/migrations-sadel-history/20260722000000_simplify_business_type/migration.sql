-- Simplify BusinessType enum to RESTAURANT and STORE only
-- The old enum has values like GENERAL_STORE, HARDWARE_STORE, etc.
-- but NOT 'STORE', so we must convert via text first.

CREATE TYPE "BusinessTypeNew" AS ENUM ('RESTAURANT', 'STORE');

ALTER TABLE "Restaurant" ALTER COLUMN "businessType" DROP DEFAULT;

ALTER TABLE "Restaurant" ALTER COLUMN "businessType" TYPE text;

UPDATE "Restaurant" SET "businessType" = 'STORE' WHERE "businessType" != 'RESTAURANT';

ALTER TABLE "Restaurant" ALTER COLUMN "businessType" TYPE "BusinessTypeNew" USING ("businessType"::"BusinessTypeNew");

DROP TYPE "BusinessType";

ALTER TYPE "BusinessTypeNew" RENAME TO "BusinessType";

ALTER TABLE "Restaurant" ALTER COLUMN "businessType" SET DEFAULT 'RESTAURANT';
