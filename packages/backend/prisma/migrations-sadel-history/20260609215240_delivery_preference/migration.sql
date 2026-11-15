/*
  Warnings:

  - You are about to drop the column `callOnArrival` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `leaveAtDoor` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `noCutlery` on the `Customer` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "DeliveryPreference" AS ENUM ('NO_DOORBELL', 'CALL_ON_ARRIVAL', 'PREFER_WHATSAPP', 'HONK_ON_ARRIVAL', 'BEWARE_OF_DOG');

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "callOnArrival",
DROP COLUMN "leaveAtDoor",
DROP COLUMN "noCutlery",
ADD COLUMN     "deliveryPreference" "DeliveryPreference";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "deliveryPreference" "DeliveryPreference";

-- CreateTable
CREATE TABLE "StoreCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT,
    "keywords" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantStoreCategory" (
    "restaurantId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantStoreCategory_pkey" PRIMARY KEY ("restaurantId","categoryId")
);

-- CreateIndex
CREATE INDEX "RestaurantStoreCategory_restaurantId_idx" ON "RestaurantStoreCategory"("restaurantId");

-- CreateIndex
CREATE INDEX "RestaurantStoreCategory_categoryId_idx" ON "RestaurantStoreCategory"("categoryId");

-- AddForeignKey
ALTER TABLE "RestaurantStoreCategory" ADD CONSTRAINT "RestaurantStoreCategory_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantStoreCategory" ADD CONSTRAINT "RestaurantStoreCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "StoreCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
