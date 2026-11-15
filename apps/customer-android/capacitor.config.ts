import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.sadel.comensal',
  appName: 'SaDeL',
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
      // Sin 'alert': el plugin NO crea una notificación propia del sistema
      // cuando la app está en primer plano.
      //
      // Motivo: en primer plano el aviso lo pone la propia web (socket.io +
      // UI + sonido propio). Si además el plugin pintara una notificación del
      // sistema, el usuario recibiría DOS avisos por el mismo pedido (uno del
      // panel y otro del sistema), y el sonido se oiría dos veces. En segundo
      // plano o con la app cerrada Android muestra la notificación con el
      // canal y el .wav correctos, que es lo que debe sonar. Un único aviso en
      // cada situación — igual que en las apps de restaurante y repartidor.
      presentationOptions: ['badge'],
    },
  },
};

export default config;
