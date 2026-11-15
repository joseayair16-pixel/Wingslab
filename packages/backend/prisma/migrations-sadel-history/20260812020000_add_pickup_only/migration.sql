-- Solo recoger en tienda: el negocio no entrega a domicilio bajo ninguna modalidad.
-- Default false: mantiene el comportamiento actual (los que quieran, lo activan).

ALTER TABLE "Restaurant" ADD COLUMN "pickupOnly" BOOLEAN NOT NULL DEFAULT false;
