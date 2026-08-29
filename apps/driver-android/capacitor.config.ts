import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sadel.driver',
  appName: 'SaDeL Repartidor',
  webDir: 'www',
  server: {
    url: 'https://reparto.pideloporsadel.app',
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
