package app.sadel.restaurant;

import android.app.ActivityManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receptor de mensajes de Firebase.
 *
 * Sustituye al `MessagingService` del plugin de Capacitor (declarado con
 * `tools:node="remove"` en el manifiesto) para poder distinguir dos tipos de
 * mensaje:
 *
 *   - `order-ring-start` / `order-ring-stop`: mensajes de datos (sin bloque
 *     `notification`) que FCM entrega incluso con la app cerrada. Se convierten
 *     en la alarma continua del Foreground Service. No se muestra ninguna
 *     notificación del sistema: la muestra el propio servicio, de modo que solo
 *     hay una.
 *   - Cualquier otro mensaje: se delega tal cual en el plugin de Capacitor,
 *     con lo que las notificaciones de chat/estado y los tokens siguen
 *     funcionando exactamente igual que antes.
 */
public class SaDelMessagingService extends FirebaseMessagingService {

    private static final String TAG = "SaDelFCM";

    private static final String TYPE_RING_START = "order-ring-start";
    private static final String TYPE_RING_STOP = "order-ring-stop";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        Map<String, String> data = remoteMessage.getData();
        String type = data == null ? null : data.get("type");

        if (TYPE_RING_START.equals(type)) {
            startAlarm(data);
            return;
        }

        if (TYPE_RING_STOP.equals(type)) {
            stopAlarm(data.get("orderId"));
            return;
        }

        // Resto de notificaciones: en primer plano el panel las gestiona (sonido
        // + UI propios) y el plugin solo reenvía a los listeners JS. En segundo
        // plano, en cambio, el plugin con presentationOptions badge-only NO
        // muestra nada, así que la publicamos manualmente con su canal de sonido
        // para no perder el aviso (p. ej. pedidos fuera de la cabeza de cola).
        if (remoteMessage.getNotification() != null && !isAppInForeground()) {
            if (showBackgroundNotification(remoteMessage)) return;
        }
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        PushNotificationsPlugin.onNewToken(token);
    }

    private void startAlarm(Map<String, String> data) {
        try {
            Intent intent = new Intent(this, OrderAlarmService.class);
            intent.setAction(OrderAlarmService.ACTION_START);
            intent.putExtra(OrderAlarmService.EXTRA_ORDER_ID, value(data.get("orderId")));
            intent.putExtra(OrderAlarmService.EXTRA_TITLE, value(data.get("title")));
            intent.putExtra(OrderAlarmService.EXTRA_BODY, value(data.get("body")));
            intent.putExtra(OrderAlarmService.EXTRA_SOUND, value(data.get("sound")));
            intent.putExtra(OrderAlarmService.EXTRA_EXPIRES_AT, parseLong(data.get("expiresAt")));
            ContextCompat.startForegroundService(this, intent);
        } catch (Throwable t) {
            Log.e(TAG, "No se pudo iniciar la alarma de pedido", t);
        }
    }

    private void stopAlarm(String orderId) {
        try {
            Intent intent = new Intent(this, OrderAlarmService.class);
            if (orderId != null && !orderId.isEmpty()) {
                intent.setAction(OrderAlarmService.ACTION_STOP);
                intent.putExtra(OrderAlarmService.EXTRA_ORDER_ID, orderId);
            } else {
                intent.setAction(OrderAlarmService.ACTION_STOP_ALL);
            }
            startService(intent);
        } catch (Throwable t) {
            // Si el sistema no permite arrancar el servicio en segundo plano,
            // cortamos la alarma por completo (stopService siempre está permitido).
            Log.w(TAG, "Stop de alarma no entregado; se detiene la alarma por completo", t);
            OrderAlarmService.stopAll(this);
        }
    }

    private static String value(String raw) {
        return raw == null ? "" : raw;
    }

    /**
     * ¿El proceso de la app está en primer plano? Ante cualquier duda se
     * responde que sí: así se conserva el comportamiento anterior (delegar al
     * plugin) y nunca se duplica un aviso.
     */
    private boolean isAppInForeground() {
        try {
            ActivityManager am = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
            if (am == null || am.getRunningAppProcesses() == null) return true;
            String pkg = getPackageName();
            for (ActivityManager.RunningAppProcessInfo proc : am.getRunningAppProcesses()) {
                if (proc != null && pkg.equals(proc.processName)
                        && proc.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
                    return true;
                }
            }
            return false;
        } catch (Throwable t) {
            return true;
        }
    }

    /**
     * Muestra manualmente la notificación del sistema para mensajes FCM normales
     * cuando la app está en segundo plano. Usa el channelId que envía el backend
     * (canales con los .wav registrados en MainActivity) y al tocar abre la app.
     * Devuelve false si no se pudo mostrar, para que el llamador delegue al
     * plugin como antes. Nunca lanza.
     */
    private boolean showBackgroundNotification(@NonNull RemoteMessage remoteMessage) {
        try {
            RemoteMessage.Notification notif = remoteMessage.getNotification();
            if (notif == null) return false;
            String title = notif.getTitle();
            String body = notif.getBody();
            if ((title == null || title.isEmpty()) && (body == null || body.isEmpty())) return false;

            String channelId = notif.getChannelId();
            if (channelId == null || channelId.isEmpty()) channelId = "default";

            int iconRes = getResources().getIdentifier("ic_stat_sadel", "drawable", getPackageName());
            if (iconRes == 0) iconRes = getApplicationInfo().icon;
            if (iconRes == 0) return false;

            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch == null) return false;
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            for (Map.Entry<String, String> entry : remoteMessage.getData().entrySet()) {
                if (entry.getKey() != null && entry.getValue() != null) {
                    launch.putExtra("sadel_fcm_" + entry.getKey(), entry.getValue());
                }
            }
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                flags |= PendingIntent.FLAG_IMMUTABLE;
            }
            PendingIntent contentIntent = PendingIntent.getActivity(
                    this, notificationIdFor(remoteMessage), launch, flags);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
                    .setSmallIcon(iconRes)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setContentIntent(contentIntent)
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_HIGH);

            NotificationManager manager =
                    (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (manager == null) return false;
            manager.notify(notificationIdFor(remoteMessage), builder.build());
            Log.i(TAG, "Notificación de segundo plano mostrada en canal " + channelId);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "No se pudo mostrar la notificación de segundo plano; se delega al plugin", t);
            return false;
        }
    }

    /** ID estable por mensaje para no apilar avisos del mismo pedido. */
    private static int notificationIdFor(RemoteMessage remoteMessage) {
        try {
            String id = remoteMessage.getMessageId();
            if (id != null && !id.isEmpty()) return id.hashCode();
            String orderId = remoteMessage.getData().get("orderId");
            if (orderId != null && !orderId.isEmpty()) return orderId.hashCode();
        } catch (Throwable ignored) {
        }
        return (int) (System.currentTimeMillis() & 0x7fffffff);
    }

    private static long parseLong(String raw) {
        if (raw == null || raw.isEmpty()) return 0L;
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
