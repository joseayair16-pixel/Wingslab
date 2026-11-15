-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "locationVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "noDriversAvailable" BOOLEAN NOT NULL DEFAULT false;
