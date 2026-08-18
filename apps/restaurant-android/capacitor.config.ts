import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sadel.restaurant',
  appName: 'SaDeL Restaurant',
  webDir: 'www',
  server: {
    url: 'https://tutienda.pideloporsadel.app',
    cleartext: false,
    androidScheme: 'https',
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
