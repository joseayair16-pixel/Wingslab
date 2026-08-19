package app.sadel.comensal;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerNotificationChannels();
        super.onCreate(savedInstanceState);
        registerPlugin(BatteryHelperPlugin.class);
    }

    /**
     * Canales de notificación con los sonidos nativos de SaDeL.
     * El backend mapea el campo `sound` del payload al channelId correspondiente,
     * de modo que la app cerrada o en segundo plano suene con el .wav real.
     */
    private void registerNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return; // Android < 8 usa los ajustes globales de notificación.
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        createChannel(manager, "llegue", "Repartidor llegó", R.raw.llegue, NotificationManager.IMPORTANCE_HIGH, attrs);
        createChannel(manager, "rezagado", "Pedido rezagado", R.raw.rezagado, NotificationManager.IMPORTANCE_HIGH, attrs);
        createChannel(manager, "mensaje", "Mensaje de chat", R.raw.mensaje, NotificationManager.IMPORTANCE_DEFAULT, attrs);
        // El comensal nunca recibe "nuevo pedido" (ese sonido es del restaurante/repartidor).
        // El canal default queda silencioso para que las notificaciones generales no suenen
        // como pedido nuevo en la app nativa.
        createSilentChannel(manager, "default", "Notificaciones generales", NotificationManager.IMPORTANCE_DEFAULT);
        // Canal de seguridad: si el backend llegara a mapear una notificación al canal
        // "notifica" (nuevo pedido), aquí nunca sonará como pedido nuevo y no fallará.
        createSilentChannel(manager, "notifica", "Pedido nuevo (sin sonido)", NotificationManager.IMPORTANCE_DEFAULT);
    }

    private void createSilentChannel(
            NotificationManager manager,
            String id,
            String name,
            int importance) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription("Canal " + name + " de SaDeL");
        channel.enableVibration(true);
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private void createChannel(
            NotificationManager manager,
            String id,
            String name,
            int soundRes,
            int importance,
            AudioAttributes attrs) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription("Canal " + name + " de SaDeL");
        channel.enableVibration(true);
        channel.setSound(Uri.parse("android.resource://" + getPackageName() + "/" + soundRes), attrs);
        manager.createNotificationChannel(channel);
    }
}