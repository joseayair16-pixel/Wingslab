-- Reutilización del QR de reparto: se guarda el token en texto plano para que
-- "asumir reparto" vuelva a usar el mismo QR en lugar de regenerarlo (que
-- invalidaba el QR ya escaneado). Los registros previos solo tienen el hash,
-- así que la columna es nullable: al reutilizar, si rawToken es NULL se
-- regenera y se rellena.
ALTER TABLE "DeliveryToken" ADD COLUMN "rawToken" TEXT;

CREATE UNIQUE INDEX "DeliveryToken_rawToken_key" ON "DeliveryToken"("rawToken");