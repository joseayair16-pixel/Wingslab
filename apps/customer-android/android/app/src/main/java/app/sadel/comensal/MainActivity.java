package app.sadel.comensal;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerNotificationChannels();
        super.onCreate(savedInstanceState);
        registerPlugin(BatteryHelperPlugin.class);
        configureWebViewForNativeLook();
    }

    /**
     * El WebView de Android aplica por defecto "font auto-sizing" y respeta el
     * tamaño de fuente del sistema, lo que hace que la misma web se vea con
     * textos más grandes y recortados respecto a la PWA/navegador. Aquí se
     * desactiva para que la UI sea idéntica en todos los dispositivos.
     */
    private void configureWebViewForNativeLook() {
        try {
            WebView webView = getBridge().getWebView();
            if (webView == null) return;
            WebSettings settings = webView.getSettings();
            settings.setTextZoom(100);
            disableTextAutosizing(settings);
        } catch (Throwable t) {
            // Nunca romper el arranque por un ajuste de presentación.
        }
    }

    /**
     * `WebSettings.setTextAutosizingEnabled` no está expuesto en el android.jar
     * de compilación, así que se invoca por reflexión: si el método existe en
     * el dispositivo se desactiva el auto-ajuste de fuente; si no, no se hace nada.
     */
    private void disableTextAutosizing(WebSettings settings) {
        try {
            java.lang.reflect.Method method = WebSettings.class.getMethod("setTextAutosizingEnabled", boolean.class);
            method.invoke(settings, Boolean.FALSE);
        } catch (Throwable ignored) {
        }
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
        // El canal default queda con llegue.wav para que CUALQUIER notificación de estado
        // (sin sound explícito en el payload) suene una vez aunque la app esté cerrada.
        createChannel(manager, "default", "Notificaciones generales", R.raw.llegue, NotificationManager.IMPORTANCE_HIGH, attrs);
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