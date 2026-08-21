-- Permitir que un restaurante desactive el pago en efectivo (solo transferencia).
-- Por defecto true para no cambiar el comportamiento actual de negocios existentes.
ALTER TABLE "Restaurant" ADD COLUMN "acceptsCash" BOOLEAN NOT NULL DEFAULT true;
