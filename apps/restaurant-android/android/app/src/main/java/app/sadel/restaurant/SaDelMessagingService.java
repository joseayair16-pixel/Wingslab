package app.sadel.restaurant;

import android.content.Intent;
import android.util.Log;

import androidx.annotation.NonNull;
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

        // Resto de notificaciones: comportamiento original de Capacitor.
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

    private static long parseLong(String raw) {
        if (raw == null || raw.isEmpty()) return 0L;
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
