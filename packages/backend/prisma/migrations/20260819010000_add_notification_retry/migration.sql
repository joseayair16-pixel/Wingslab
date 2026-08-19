-- Retry queue for critical notifications that failed on first delivery.
-- If neither web-push nor FCM delivered, the push is persisted here and a
-- cron job re-sends it until delivered or the TTL expires.
CREATE TABLE "NotificationRetry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "payload" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationRetry_dedupeKey_key" ON "NotificationRetry"("dedupeKey");
CREATE INDEX "NotificationRetry_nextAttemptAt_idx" ON "NotificationRetry"("nextAttemptAt");
CREATE INDEX "NotificationRetry_expiresAt_idx" ON "NotificationRetry"("expiresAt");