import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sadel.driver',
  appName: 'SaDeL Repartidor',
  webDir: 'www',
  server: {
    url: 'https://wingslab-disabled.invalid',
    cleartext: false,
    androidScheme: 'https',
    errorPath: 'offline.html',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      // Sin 'alert'/'banner'/'list': el plugin NO crea una notificación propia
      // cuando la app está en primer plano.
      //
      // Motivo: en primer plano el aviso lo pone el propio panel (socket.io +
      // UI) y la alarma continua suena en el Foreground Service; si además el
      // plugin pintara una notificación del sistema habría dos sonidos. En
      // segundo plano Android muestra la notificación con el canal y el .wav
      // correctos. Un único sonido en cada situación.
      presentationOptions: ['badge'],
    },
  },
};

export default config;
