import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sadel.restaurant',
  appName: 'SaDeL Restaurant',
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
      //Motivo: en primer plano el aviso lo pone el propio panel (socket.io +
      // UI + sonido) y, si además el plugin pintara una notificación del
      // sistema, el mismo sonido se oiría dos veces. En segundo plano Android
      // muestra la notificación él mismo con el canal y el .wav correctos
      // (notifica/llegue/rezagado/mensaje), que es lo que debe sonar cuando la
      // app no está abierta. Un único sonido en cada situación.
      presentationOptions: ['badge'],
    },
  },
};

export default config;
