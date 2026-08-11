-- DropIndex
DROP INDEX "OperatingHours_restaurantId_dayOfWeek_key";

-- AlterTable
ALTER TABLE "OperatingHours" ADD COLUMN     "shiftIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "OperatingHours_restaurantId_dayOfWeek_shiftIndex_key" ON "OperatingHours"("restaurantId", "dayOfWeek", "shiftIndex");
