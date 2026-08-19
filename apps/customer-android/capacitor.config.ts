import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sadel.comensal',
  appName: 'SaDeL',
  webDir: 'www',
  server: {
    url: 'https://pideloporsadel.app',
    cleartext: false,
    androidScheme: 'https',
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      // En foreground el sonido lo reproduce el WebView (socket.io) una sola vez.
      // Si el sistema también sonara el canal nativo en foreground habría doble
      // reproducción (sistema + web). En background el canal nativo suena normal.
      presentationOptions: ['badge', 'alert'],
    },
  },
};

export default config;