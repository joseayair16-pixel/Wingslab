-- Sistema de promociones: multi-compra por producto, promos a nivel de pedido y cupones.

-- Producto: promoción por cantidad (2x1, 3x2, ...). Solo aplica para sellBy=UNIT.
ALTER TABLE "Product" ADD COLUMN "promoType" TEXT;
ALTER TABLE "Product" ADD COLUMN "promoBuyQuantity" INTEGER;
ALTER TABLE "Product" ADD COLUMN "promoPayQuantity" INTEGER;

-- Restaurante: promociones a nivel de pedido.
ALTER TABLE "Restaurant" ADD COLUMN "promoFreeDeliveryThreshold" DOUBLE PRECISION;
ALTER TABLE "Restaurant" ADD COLUMN "promoMinOrderAmount" DOUBLE PRECISION;
ALTER TABLE "Restaurant" ADD COLUMN "promoMinOrderPercent" DOUBLE PRECISION;

-- Pedido: persistencia del descuento aplicado.
ALTER TABLE "Order" ADD COLUMN "promoCode" TEXT;
ALTER TABLE "Order" ADD COLUMN "promoDiscountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "discountBreakdown" TEXT;

--Cupones por restaurante.
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "minOrderAmount" DOUBLE PRECISION,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromoCode_restaurantId_code_key" ON "PromoCode"("restaurantId", "code");
CREATE INDEX "PromoCode_restaurantId_idx" ON "PromoCode"("restaurantId");

ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;