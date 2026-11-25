-- Grant the application role the permissions needed by the loyalty ledger.
-- Existing environments may already have these grants. Fresh installations
-- should not rely on manual grants for tables created after the baseline.
GRANT SELECT, INSERT, UPDATE ON "LoyaltyCard" TO wingslab_local;
GRANT SELECT, INSERT, DELETE ON "LoyaltyStamp" TO wingslab_local;
GRANT SELECT, INSERT, UPDATE, DELETE ON "LoyaltyRedemption" TO wingslab_local;
