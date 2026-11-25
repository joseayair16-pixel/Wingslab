ALTER TABLE "Customer"
ADD COLUMN "mercadoPagoCustomerId" TEXT;

CREATE UNIQUE INDEX "Customer_mercadoPagoCustomerId_key"
ON "Customer"("mercadoPagoCustomerId");
