-- VersionCode nativo del APK que registró el token FCM (null = legacy/desconocido).
ALTER TABLE "FcmToken" ADD COLUMN "appVersion" INTEGER;
