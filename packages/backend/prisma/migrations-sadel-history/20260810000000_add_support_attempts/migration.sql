-- Intentos de solicitud de apoyo a red usados por un pedido (máximo 2 reenvíos).

ALTER TABLE "Order" ADD COLUMN "supportAttempts" INTEGER NOT NULL DEFAULT 0;