-- Recordatorio previo (15 min antes) de entrega/recogida programada
ALTER TABLE "Order" ADD COLUMN "scheduledReminderSentAt" TIMESTAMP(3);

-- Índice para consultas eficientes del job de recordatorio previo
CREATE INDEX "Order_scheduledDeliveryAt_status_idx" ON "Order"("scheduledDeliveryAt", "status");
