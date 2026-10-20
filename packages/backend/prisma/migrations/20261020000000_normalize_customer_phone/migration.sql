BEGIN;

ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT;

WITH customer_phones AS (
  SELECT
    "id",
    regexp_replace("phone", '[^0-9]', '', 'g') AS digits
  FROM "User"
  WHERE "role" = 'CUSTOMER'
), normalized AS (
  SELECT
    "id",
    CASE
      WHEN length(digits) = 10 THEN digits
      WHEN length(digits) = 12 AND left(digits, 2) = '52' THEN right(digits, 10)
      WHEN length(digits) = 13 AND left(digits, 3) = '521' THEN right(digits, 10)
      ELSE NULL
    END AS phone_normalized
  FROM customer_phones
)
UPDATE "User" AS users
SET "phoneNormalized" = normalized.phone_normalized
FROM normalized
WHERE users."id" = normalized."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role" = 'CUSTOMER'
      AND "phoneNormalized" IS NULL
  ) THEN
    RAISE EXCEPTION 'Customer records with unsupported phone formats exist. Normalize them to a 10-digit Mexican number before applying this migration.';
  END IF;

  IF EXISTS (
    SELECT "phoneNormalized"
    FROM "User"
    WHERE "role" = 'CUSTOMER'
      AND "phoneNormalized" IS NOT NULL
    GROUP BY "phoneNormalized"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate customer phone numbers exist after MX normalization. Resolve these accounts before applying this migration.';
  END IF;
END $$;

UPDATE "User"
SET "phone" = "phoneNormalized"
WHERE "role" = 'CUSTOMER';

CREATE UNIQUE INDEX "User_phoneNormalized_role_key"
  ON "User"("phoneNormalized", "role");

COMMIT;
