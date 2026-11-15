BEGIN;

-- Stop concurrent account writes while checking legacy data and building the
-- index, so a case-variant duplicate cannot slip in between those operations.
LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim("email"))
    FROM "User"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Email duplicates exist after case-insensitive normalization. Resolve them before applying this migration.';
  END IF;
END $$;

-- Prisma cannot represent a functional index in schema.prisma.
CREATE UNIQUE INDEX "User_email_ci_key"
  ON "User" (lower(btrim("email")));

COMMIT;
