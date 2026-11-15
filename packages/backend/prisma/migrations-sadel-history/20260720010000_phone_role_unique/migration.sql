-- Drop the global unique constraint on phone (allows same phone across roles)
DROP INDEX IF EXISTS "User_phone_key";
DROP INDEX IF EXISTS "User_phone_idx";

-- Create composite unique constraint on (phone, role) so same phone
-- can be used for different roles (DRIVER, CUSTOMER, RESTAURANT, ADMIN)
-- but never for the same role twice.
CREATE UNIQUE INDEX "User_phone_role_key" ON "User"("phone", "role");

CREATE INDEX "User_phone_idx" ON "User"("phone");
