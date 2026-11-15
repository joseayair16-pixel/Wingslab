-- Opt-in/out para prestar apoyo a la red (restaurantes con reparto propio).
-- Default true: mantiene el comportamiento actual (todos prestan apoyo salvo que lo desactiven).

ALTER TABLE "Restaurant" ADD COLUMN "supportsNetworkDelivery" BOOLEAN NOT NULL DEFAULT true;
