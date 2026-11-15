-- Additive, non-destructive consent ledger. Existing users remain opted out.
CREATE TABLE "MarketingConsent" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "grantedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MarketingConsent_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "MarketingConsent"
    ADD CONSTRAINT "MarketingConsent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
