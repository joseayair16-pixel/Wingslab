-- Última posición conocida del repartidor por pedido (snapshot para el comensal)
ALTER TABLE "Order" ADD COLUMN "lastDriverLatitude" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "lastDriverLongitude" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "lastDriverLocationAt" TIMESTAMP(3);
