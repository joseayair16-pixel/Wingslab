package app.sadel.restaurant;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

import java.lang.reflect.Method;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerNotificationChannels();
        super.onCreate(savedInstanceState);
        registerPlugin(BatteryHelperPlugin.class);
        registerPlugin(OrderAlarmPlugin.class);
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
            // Permite el audio del WebView sin requerir el primer toque: sin esto,
            // Android silencia el audio web hasta la 1ª interacción.
            settings.setMediaPlaybackRequiresUserGesture(false);
            disableTextAutosizing(settings);
        } catch (Throwable t) {
        }
    }

    /**
     * `WebSettings.setTextAutosizingEnabled` no está expuesto en el android.jar
     * de compileSdk 36, así que se invoca por reflexión: si el método existe en
     * el dispositivo se desactiva el auto-ajuste de fuente; si no, no se hace nada.
     */
    private void disableTextAutosizing(WebSettings settings) {
        try {
            Method method = WebSettings.class.getMethod("setTextAutosizingEnabled", boolean.class);
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

        maybeResetNotificationChannels(manager);

        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        createChannel(manager, "notifica", "Pedido nuevo", R.raw.notifica, NotificationManager.IMPORTANCE_HIGH, attrs);
        createChannel(manager, "llegue", "Repartidor llegó", R.raw.llegue, NotificationManager.IMPORTANCE_HIGH, attrs);
        createChannel(manager, "rezagado", "Pedido rezagado", R.raw.rezagado, NotificationManager.IMPORTANCE_HIGH, attrs);
        createChannel(manager, "mensaje", "Mensaje de chat", R.raw.mensaje, NotificationManager.IMPORTANCE_DEFAULT, attrs);
        createChannel(manager, "default", "Notificaciones generales", R.raw.notifica, NotificationManager.IMPORTANCE_DEFAULT, attrs);
    }

    /**
     * Versión del esquema de canales. Android NO actualiza el sonido ni la
     * importancia de un canal ya creado (`createNotificationChannel` lo ignora
     * en silencio): sin esto, un usuario que instaló una versión anterior
     * conservaría el sonido viejo para siempre. Al subir este número los
     * canales se borran y recrean con la configuración nueva. Instalaciones
     * frescas no notan diferencia.
     */
    private static final int NOTIFICATION_CHANNEL_VERSION = 1;

    private static final String[] NOTIFICATION_CHANNEL_IDS =
            {"notifica", "llegue", "rezagado", "mensaje", "default"};

    private void maybeResetNotificationChannels(NotificationManager manager) {
        try {
            SharedPreferences prefs = getSharedPreferences("sadel_notification_channels", MODE_PRIVATE);
            int stored = prefs.getInt("channel_version", 0);
            if (stored >= NOTIFICATION_CHANNEL_VERSION) return;
            for (String id : NOTIFICATION_CHANNEL_IDS) {
                try {
                    manager.deleteNotificationChannel(id);
                } catch (Exception ignored) {
                }
            }
            prefs.edit().putInt("channel_version", NOTIFICATION_CHANNEL_VERSION).apply();
        } catch (Exception ignored) {
        }
    }

    private void createChannel(
            NotificationManager manager,
            String id,
            String name,
            int soundRes,
            int importance,
            AudioAttributes attrs) {
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.setDescription("Canal " + name + " de SaDeL Restaurant");
        channel.enableVibration(true);
        channel.setSound(Uri.parse("android.resource://" + getPackageName() + "/" + soundRes), attrs);
        manager.createNotificationChannel(channel);
    }
}
