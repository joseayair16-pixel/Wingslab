-- Records of WhatsApp reminders/notifications to avoid duplicate sends.

ALTER TABLE "RestaurantBillingSettlement" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
ALTER TABLE "RestaurantBillingSettlement" ADD COLUMN "suspendedReminderSentAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD COLUMN "whatsappThankYouSentAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "whatsappThankYouSkippedAt" TIMESTAMP(3);