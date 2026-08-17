-- Persist when a network-support request was made so expired requests can be
-- resolved reliably by the JIT job (not only an in-memory setTimeout that dies
-- on server restarts).
ALTER TABLE "Order" ADD COLUMN "supportRequestedAt" TIMESTAMP(3);
